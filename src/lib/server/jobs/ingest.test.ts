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
import { createFixtureAdapter, createRssAdapter } from '../news/adapters';
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
			return {
				items: parseFeed(feeds[source.id] ?? ''),
				fetched_at: ctx.now.toISOString(),
				not_modified: false,
				validators: { etag: null, last_modified: null }
			};
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

	it('a real article never joins a demo event, even with the same headline', async () => {
		await runIngestJob(); // fixture (demo) sources: the Kessel River story becomes a demo event

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const realSource: SourceDefinition = {
			...FIXTURE_SOURCES[0]!,
			id: 'real-wire',
			is_demo: false
		};
		const sameStory = `<rss><channel><item>
			<title>Avalor and Meridia sign Kessel River water-sharing accord</title>
			<link>https://real.example/kessel</link>
			<pubDate>Fri, 13 Nov 2026 00:30:00 GMT</pubDate></item></channel></rss>`;
		const next = await runIngestJob({
			deps: deps({
				registry: [realSource],
				adapters: { fixture: inlineAdapter({ 'real-wire': sameStory }) }
			})
		});

		expect(next).toMatchObject({ counters: { events_created: 1, events_updated: 0 } });
		const realEvents = db.select().from(events).where(eq(events.is_demo, false)).all();
		expect(realEvents).toHaveLength(1);
		expect(realEvents[0]?.source_count).toBe(1);
	});
});

describe('conditional GET', () => {
	it('stores the validators of a 200 and sends them on the next run; a 304 ingests nothing', async () => {
		const rssSource: SourceDefinition = {
			...FIXTURE_SOURCES[0]!,
			id: 'rss-wire',
			kind: 'rss',
			feed_url: 'https://feeds.example/rss.xml'
		};
		const sentEtags: (string | undefined)[] = [];
		const safeFetch: SafeFetch = async (_url, init) => {
			sentEtags.push(init?.headers?.['if-none-match']);
			if (init?.headers?.['if-none-match'] === '"v1"') return new Response(null, { status: 304 });
			return new Response(
				`<rss><channel><item><title>Port Selene opens a new ferry line</title>
				<link>https://feeds.example/1</link><pubDate>Thu, 12 Nov 2026 22:00:00 GMT</pubDate></item></channel></rss>`,
				{ status: 200, headers: { etag: '"v1"' } }
			);
		};
		const conditionalDeps = deps({
			registry: [rssSource],
			adapters: { rss: createRssAdapter() },
			safeFetch
		});

		const first = await runIngestJob({ deps: conditionalDeps });
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const second = await runIngestJob({ deps: conditionalDeps });

		expect(sentEtags).toEqual([undefined, '"v1"']);
		expect(first).toMatchObject({ status: 'succeeded', counters: { articles_inserted: 1 } });
		expect(second).toMatchObject({
			status: 'succeeded',
			counters: { items_fetched: 0, articles_inserted: 0 }
		});
		const [row] = db.select().from(sources).where(eq(sources.id, 'rss-wire')).all();
		expect(row?.etag).toBe('"v1"');
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
		const allDisabled = sourceRegistryFor('production').map((source) => ({ ...source, enabled: false }));
		const none = await runIngestJob({ deps: deps({ registry: allDisabled }) });
		expect(none).toMatchObject({ status: 'failed' });
		expect((await repositories.jobs.listRecent(1))[0]!.error).toBe('no enabled sources');
	});

	it('after the job time limit, skips the remaining sources without blaming them, and skips grouping', async () => {
		const controller = new AbortController();
		const fixtureAdapter = createFixtureAdapter(REPO_ROOT);
		const abortAfterFirst: NewsSourceAdapter = {
			kind: 'fixture',
			async fetch(source, ctx) {
				const result = await fixtureAdapter.fetch(source, ctx);
				controller.abort(); // the 20-minute limit hits while wire A is being stored
				return result;
			}
		};
		const result = await runJob(
			{ jobs: repositories.jobs, logger: logger(), now: () => clock },
			{ job_type: 'ingest', ...hourlyJobSlot('ingest', NOW), trigger: 'cron', force: false },
			(ctx) =>
				runIngest(deps({ adapters: { fixture: abortAfterFirst }, concurrency: 1 }), {
					...ctx,
					signal: controller.signal
				})
		);

		expect(result).toMatchObject({
			status: 'partial',
			counters: { sources_ok: 1, sources_failed: 0, articles_inserted: 2 }
		});
		if (result.status === 'skipped') throw new Error('expected a run');
		expect(result.counters).not.toHaveProperty('articles_grouped');
		expect(rowCounts()).toMatchObject({ articles: 2, events: 0, event_articles: 0 });

		const sourceRows = new Map(
			db
				.select()
				.from(sources)
				.all()
				.map((row) => [row.id, row])
		);
		for (const id of ['fixture-wire-b', 'fixture-wire-c']) {
			expect(sourceRows.get(id)).toMatchObject({
				last_success_at: null,
				last_error_at: null,
				last_error: null
			});
		}
		expect((await repositories.jobs.listRecent(1))[0]!.error).toContain('2 sources not attempted');
	});

	it('drops items older than the max item age, keeps undated ones, and counts the drop', async () => {
		const hoursAgo = (hours: number) =>
			new Date(NOW.getTime() - hours * 60 * 60 * 1000).toUTCString();
		const xml = `<rss><channel>
			<item><title>Archive item from last week</title><link>https://age.example/old</link><pubDate>${hoursAgo(73)}</pubDate></item>
			<item><title>Fresh item from this morning</title><link>https://age.example/new</link><pubDate>${hoursAgo(1)}</pubDate></item>
			<item><title>Undated item</title><link>https://age.example/undated</link></item>
		</channel></rss>`;
		const registry: SourceDefinition[] = [{ ...FIXTURE_SOURCES[0]!, id: 'age-wire' }];
		const result = await runIngestJob({
			deps: deps({ registry, adapters: { fixture: inlineAdapter({ 'age-wire': xml }) } })
		});

		expect(result).toMatchObject({
			status: 'succeeded',
			counters: { items_fetched: 3, items_dropped: 1, articles_inserted: 2 }
		});
		expect(
			db
				.select()
				.from(articles)
				.all()
				.map((row) => row.title)
				.sort()
		).toEqual(['Fresh item from this morning', 'Undated item']);
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
