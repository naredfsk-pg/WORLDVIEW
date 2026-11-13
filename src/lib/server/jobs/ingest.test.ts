/**
 * End-to-end ingest against fixture feeds and an in-memory database (no network).
 * Covers PRD §11 acceptance #3 (grouping), #4 (idempotency) and #5 (timezone), plus partial
 * runs, backoff and the stale-claim guard. The test is a composition root, like scripts/job.ts,
 * so it may wire the concrete db; the job code itself only sees repository interfaces.
 */
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { articles, eventArticles, events, sources } from '#lib/server/db/schema.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import type { JobOutcome } from '#lib/types/jobs.js';
import type { NewsSourceAdapter, SafeFetch, SourceDefinition } from '#lib/types/news.js';
import type { Repositories } from '#lib/types/repositories.js';
import { createFixtureAdapter } from '../news/adapters';
import { NewsFetchError } from '../news/errors';
import { parseFeed } from '../news/feed-parser';
import { FIXTURE_SOURCES, sourceRegistryFor } from '../news/sources';
import { previewIngest, runIngest, type IngestDeps } from './ingest';
import { hourlyJobSlot } from './job-slots';
import { createJsonLogger } from './logger';
import { exitCodeFor, runJob } from './runner';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NOW = new Date('2026-11-13T00:00:00.000Z'); // 07:00 ICT

const noNetwork: SafeFetch = async () => {
	throw new Error('network must not be used in tests');
};

let db: Db;
let repositories: Repositories;
let logLines: Record<string, unknown>[];
let clock: Date;

beforeEach(() => {
	db = openTestDb();
	repositories = createRepositories(db);
	logLines = [];
	clock = NOW;
});
afterEach(() => db.$client.close());

const logger = () =>
	createJsonLogger(
		(line) => logLines.push(JSON.parse(line)),
		() => clock
	);

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps {
	return {
		ingest: repositories.ingest,
		digest: repositories.digest,
		registry: sourceRegistryFor('fixtures'),
		adapters: { fixture: createFixtureAdapter(REPO_ROOT) },
		safeFetch: noNetwork,
		retry: { sleep: async () => {}, random: () => 0 },
		...overrides
	};
}

function runIngestJob(options: { force?: boolean; deps?: IngestDeps } = {}) {
	return runJob(
		{ jobs: repositories.jobs, logger: logger(), now: () => clock },
		{
			job_type: 'ingest',
			...hourlyJobSlot('ingest', clock),
			trigger: options.force ? 'manual' : 'cron',
			force: options.force ?? false
		},
		(ctx) => runIngest(options.deps ?? deps(), ctx)
	);
}

function rowCounts() {
	return {
		articles: db.select().from(articles).all().length,
		events: db.select().from(events).all().length,
		event_articles: db.select().from(eventArticles).all().length
	};
}

/** A `fixture` adapter that serves inline XML per source id. */
function inlineAdapter(feeds: Record<string, string>): NewsSourceAdapter {
	return {
		kind: 'fixture',
		async fetch(source, ctx) {
			return { items: parseFeed(feeds[source.id] ?? ''), fetched_at: ctx.now.toISOString() };
		}
	};
}

describe('ingest job on fixture feeds', () => {
	it('acceptance #3: three sources on the same story become one event; unrelated stories stay separate', async () => {
		const result = await runIngestJob();

		expect(result).toMatchObject({ status: 'succeeded', finish_recorded: true });
		expect(exitCodeFor(result)).toBe(0);
		if (result.status === 'skipped') throw new Error('expected a run');
		expect(result.counters).toEqual({
			sources_ok: 3,
			sources_failed: 0,
			items_fetched: 9,
			items_dropped: 2,
			articles_inserted: 6,
			duplicates_url: 1,
			duplicates_content: 0,
			articles_grouped: 6,
			events_created: 4,
			events_updated: 0
		});

		const kessel = db
			.select({ event_id: eventArticles.event_id })
			.from(eventArticles)
			.innerJoin(articles, eq(articles.id, eventArticles.article_id))
			.all()
			.reduce<Map<string, number>>(
				(byEvent, row) => byEvent.set(row.event_id, (byEvent.get(row.event_id) ?? 0) + 1),
				new Map()
			);
		expect([...kessel.values()].sort()).toEqual([1, 1, 1, 3]);

		const storyEvent = db.select().from(events).where(eq(events.source_count, 3)).all();
		expect(storyEvent).toHaveLength(1);
		expect(storyEvent[0]).toMatchObject({
			status: 'draft',
			is_demo: true,
			first_seen_at: '2026-11-12T16:30:00.000Z',
			event_date: '2026-11-12', // 23:30 ICT
			occurred_at: null
		});
	});

	it('stores only allowed, cleaned metadata: no full text, excerpts only when allowed, no guessed times', async () => {
		await runIngestJob();
		const rows = db.select().from(articles).all();
		const bySource = (id: string) => rows.filter((row) => row.source_id === id);

		expect(JSON.stringify(rows)).not.toMatch(/FULL ARTICLE TEXT|<script|alert\(/);
		const kesselA = bySource('fixture-wire-a').find((row) => row.title.startsWith('Avalor'))!;
		expect(kesselA).toMatchObject({
			canonical_url: 'https://fixtures.worldview.invalid/wire-a/2026/11/kessel-accord',
			excerpt: 'The two fictional states agreed to share the river’s flow during dry months.',
			published_at: '2026-11-12T16:30:00.000Z',
			ingested_at: NOW.toISOString(),
			raw_metadata: { guid: 'wire-a-1001', author: 'Desk A', categories: ['Avalor', 'Water'] }
		});
		expect(bySource('fixture-wire-b').every((row) => row.excerpt === null)).toBe(true);
		const zoneless = rows.find((row) => row.title.startsWith('Port Selene'))!;
		expect(zoneless.published_at).toBeNull();
		const thai = rows.find((row) => row.language === 'th')!;
		expect(thai.excerpt).toBe('นักท่องเที่ยวหลายพันคนร่วมชมขบวนโคมไฟในเมืองสมมติแห่งนี้');
	});

	it('acceptance #4: a second run of the same slot is skipped, and a forced rerun adds nothing', async () => {
		await runIngestJob();
		const before = rowCounts();

		clock = new Date(NOW.getTime() + 10 * 60 * 1000);
		const again = await runIngestJob();
		expect(again).toEqual({ status: 'skipped', reason: 'already_done' });
		expect(exitCodeFor(again)).toBe(0);
		expect(rowCounts()).toEqual(before);

		const forced = await runIngestJob({ force: true });
		expect(forced).toMatchObject({ status: 'succeeded' });
		if (forced.status === 'skipped') throw new Error('expected a run');
		expect(forced.counters).toMatchObject({
			items_fetched: 9,
			articles_inserted: 0,
			duplicates_url: 7,
			articles_grouped: 0,
			events_created: 0,
			events_updated: 0
		});
		expect(rowCounts()).toEqual(before);
		const [run] = await repositories.jobs.listRecent(5);
		expect(run).toMatchObject({ attempts: 2, trigger: 'manual', status: 'succeeded' });
		expect(await repositories.jobs.listRecent(5)).toHaveLength(1);
	});

	it('the next hourly slot re-runs without duplicates and attaches a new report to the existing event', async () => {
		await runIngestJob();
		const before = rowCounts();

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const followUp = `<rss><channel><item>
			<title>Kessel River accord: Avalor and Meridia sign water-sharing deal</title>
			<link>https://fixtures.worldview.invalid/wire-a/2026/11/kessel-follow-up</link>
			<pubDate>Fri, 13 Nov 2026 00:30:00 GMT</pubDate></item></channel></rss>`;
		const registry = [FIXTURE_SOURCES[0]!];
		const next = await runIngestJob({
			deps: deps({ registry, adapters: { fixture: inlineAdapter({ 'fixture-wire-a': followUp }) } })
		});

		expect(next).toMatchObject({
			status: 'succeeded',
			counters: { articles_inserted: 1, events_created: 0, events_updated: 1, articles_grouped: 1 }
		});
		expect(rowCounts()).toEqual({
			articles: before.articles + 1,
			events: before.events,
			event_articles: before.event_articles + 1
		});
		expect(await repositories.jobs.listRecent(5)).toHaveLength(2);
	});

	it('acceptance #5: event_date follows Asia/Bangkok around midnight (16:59:59Z vs 17:00:00Z)', async () => {
		const registry: SourceDefinition[] = [{ ...FIXTURE_SOURCES[0]!, id: 'tz-wire' }];
		const xml = `<rss><channel>
			<item><title>Late night market closes in Port Selene</title><link>https://tz.example/1</link><pubDate>Thu, 12 Nov 2026 16:59:59 GMT</pubDate></item>
			<item><title>Northland parliament opens its winter session</title><link>https://tz.example/2</link><pubDate>Thu, 12 Nov 2026 17:00:00 GMT</pubDate></item>
		</channel></rss>`;
		await runIngestJob({
			deps: deps({ registry, adapters: { fixture: inlineAdapter({ 'tz-wire': xml }) } })
		});

		const rows = db
			.select({ title: articles.title, event_date: events.event_date })
			.from(eventArticles)
			.innerJoin(articles, eq(articles.id, eventArticles.article_id))
			.innerJoin(events, eq(events.id, eventArticles.event_id))
			.all();
		expect(Object.fromEntries(rows.map((row) => [row.title, row.event_date]))).toEqual({
			'Late night market closes in Port Selene': '2026-11-12',
			'Northland parliament opens its winter session': '2026-11-13'
		});
	});
});

describe('ingest job failures', () => {
	it('one failing source makes the run partial and is recorded on its source row; others still ingest', async () => {
		let flakyCalls = 0;
		const flakyAdapter: NewsSourceAdapter = {
			kind: 'rss',
			async fetch() {
				flakyCalls++;
				throw new NewsFetchError({
					kind: 'http_error',
					retryable: true,
					status: 503,
					message: 'HTTP 503'
				});
			}
		};
		const registry: SourceDefinition[] = [
			...sourceRegistryFor('fixtures'),
			{
				...FIXTURE_SOURCES[0]!,
				id: 'broken-wire',
				name: 'Broken',
				feed_url: 'tests/fixtures/feeds/malformed.xml'
			},
			{
				...FIXTURE_SOURCES[0]!,
				id: 'flaky-wire',
				name: 'Flaky',
				kind: 'rss',
				feed_url: 'https://flaky.example/rss.xml'
			}
		];
		const result = await runIngestJob({
			deps: deps({
				registry,
				adapters: { fixture: createFixtureAdapter(REPO_ROOT), rss: flakyAdapter }
			})
		});

		expect(result).toMatchObject({
			status: 'partial',
			counters: { sources_ok: 3, sources_failed: 2, articles_inserted: 6 }
		});
		expect(exitCodeFor(result)).toBe(2);
		expect(flakyCalls).toBe(3); // max_attempts for a retryable error

		const sourceRows = new Map(
			db
				.select()
				.from(sources)
				.all()
				.map((row) => [row.id, row])
		);
		expect(sourceRows.get('broken-wire')).toMatchObject({
			last_success_at: null,
			last_error_at: NOW.toISOString(),
			last_error: 'parse_error: malformed XML'
		});
		expect(sourceRows.get('flaky-wire')).toMatchObject({
			last_success_at: null,
			last_error: 'http_error: HTTP 503'
		});
		expect(sourceRows.get('fixture-wire-a')).toMatchObject({
			last_success_at: NOW.toISOString(),
			last_error: null
		});

		const [run] = await repositories.jobs.listRecent(1);
		expect(run).toMatchObject({ status: 'partial' });
		expect(run!.error).toContain('2 of 5 sources failed');
		expect(logLines.filter((line) => line['msg'] === 'source fetch retry')).toHaveLength(2);
	});

	it('fails the run when every source fails, and when no source is enabled', async () => {
		const allBroken = [{ ...FIXTURE_SOURCES[0]!, feed_url: 'tests/fixtures/feeds/malformed.xml' }];
		const failed = await runIngestJob({ deps: deps({ registry: allBroken }) });
		expect(failed).toMatchObject({ status: 'failed' });
		expect(exitCodeFor(failed)).toBe(1);

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const none = await runIngestJob({ deps: deps({ registry: sourceRegistryFor('production') }) });
		expect(none).toMatchObject({ status: 'failed' });
		expect((await repositories.jobs.listRecent(1))[0]!.error).toBe('no enabled sources');
	});

	it('a run whose claim was reclaimed as stale cannot overwrite the newer run', async () => {
		let reclaimed: unknown;
		const result = await runJob(
			{ jobs: repositories.jobs, logger: logger(), now: () => clock },
			{ job_type: 'ingest', ...hourlyJobSlot('ingest', NOW), trigger: 'cron', force: false },
			async (): Promise<JobOutcome> => {
				// While this run is "stuck", another process sees a >30 min old claim and takes over.
				reclaimed = await repositories.jobs.claim({
					job_type: 'ingest',
					...hourlyJobSlot('ingest', NOW),
					trigger: 'manual',
					force: false,
					now: new Date(NOW.getTime() + 31 * 60 * 1000).toISOString()
				});
				return { status: 'failed', counters: {}, error: 'stale process finally gave up' };
			}
		);

		expect(reclaimed).toMatchObject({ claimed: true, run: { attempts: 2 } });
		expect(result).toMatchObject({ status: 'failed', finish_recorded: false });
		expect((await repositories.jobs.listRecent(1))[0]).toMatchObject({
			status: 'running',
			attempts: 2,
			error: null
		});
		expect(
			logLines.some((line) => line['msg'] === 'job finished after its claim was taken over')
		).toBe(true);
	});

	it('records a crash inside the job body as a failed run with a sanitized error', async () => {
		const result = await runJob(
			{ jobs: repositories.jobs, logger: logger(), now: () => clock },
			{ job_type: 'ingest', ...hourlyJobSlot('ingest', NOW), trigger: 'cron', force: false },
			async () => {
				throw new Error('boom\n    at secret/path.ts:1');
			}
		);
		expect(result).toMatchObject({ status: 'failed', finish_recorded: true });
		expect((await repositories.jobs.listRecent(1))[0]!.error).toBe(
			'Error: boom at secret/path.ts:1'
		);
	});
});

describe('previewIngest (--dry-run)', () => {
	it('fetches and normalizes without touching the database', async () => {
		const outcome = await previewIngest(
			{
				registry: sourceRegistryFor('fixtures'),
				adapters: { fixture: createFixtureAdapter(REPO_ROOT) },
				safeFetch: noNetwork
			},
			{ now: () => clock, logger: logger(), signal: new AbortController().signal }
		);
		expect(outcome).toEqual({
			status: 'succeeded',
			counters: { sources_ok: 3, sources_failed: 0, items_fetched: 9, items_dropped: 2 },
			error: null
		});
		expect(rowCounts()).toEqual({ articles: 0, events: 0, event_articles: 0 });
		expect(db.select().from(sources).all()).toHaveLength(0);
		expect(await repositories.jobs.listRecent(1)).toHaveLength(0);
	});
});
