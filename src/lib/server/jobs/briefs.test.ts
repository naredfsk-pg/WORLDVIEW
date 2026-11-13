/**
 * Brief and archive jobs against an in-memory database: acceptance #5 (Bangkok windows around
 * midnight) and #6 (morning + evening brief, idempotent, readable for /brief/YYYY-MM-DD), the
 * region quota, selection reasons, admin-hidden briefs and late reports in the daily snapshot.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { dailyBriefEvents, dailyBriefs } from '#lib/server/db/schema.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import type { BriefEdition, EditorialSignals, RegionSlug } from '#lib/types/domain.js';
import type { BriefCandidate, Repositories } from '#lib/types/repositories.js';
import { rankBriefCandidates } from './brief-ranking';
import { briefWindow, runBrief } from './briefs';
import { archiveJobSlot, briefJobSlot } from './job-slots';
import { createJsonLogger } from './logger';
import { runJob } from './runner';

let db: Db;
let repositories: Repositories;
let counter = 0;

beforeEach(async () => {
	db = openTestDb();
	repositories = createRepositories(db);
	await repositories.ingest.syncSources([
		{
			id: 'real-wire',
			name: 'Real Wire',
			kind: 'rss',
			homepage_url: 'https://real.example',
			feed_url: 'https://real.example/rss.xml',
			license_notes: 'test',
			allow_excerpt: false,
			is_demo: false,
			enabled: true
		},
		{
			id: 'demo-wire',
			name: 'Demo Wire',
			kind: 'fixture',
			homepage_url: 'https://demo.example',
			feed_url: 'tests/fixtures/feeds/wire-a.xml',
			license_notes: 'test',
			allow_excerpt: false,
			is_demo: true,
			enabled: true
		}
	]);
});
afterEach(() => db.$client.close());

interface EventSpec {
	publishedAt: string;
	ingestedAt?: string;
	regions?: RegionSlug[];
	signals?: EditorialSignals;
	demo?: boolean;
}

/** A published event with one article. */
async function publishedEvent(spec: EventSpec): Promise<string> {
	counter++;
	const ingestedAt = spec.ingestedAt ?? spec.publishedAt;
	const { article_id } = await repositories.ingest.insertArticleIfNew({
		source_id: spec.demo ? 'demo-wire' : 'real-wire',
		source_url: `https://real.example/${counter}`,
		canonical_url: `https://real.example/${counter}`,
		publisher_name: spec.demo ? 'Demo Wire' : 'Real Wire',
		title: `Story ${counter}`,
		excerpt: null,
		language: 'en',
		published_at: spec.publishedAt,
		ingested_at: ingestedAt,
		content_hash: `hash-${counter}`,
		raw_metadata: {}
	});
	const id = await repositories.digest.createDraftEvent([article_id], 1, ingestedAt);
	await repositories.digest.saveEventContent(
		id,
		{
			title_th: `ข่าวที่ ${counter}`,
			summary_th: 'สรุปข่าว',
			what_happened_th: 'เกิดเหตุการณ์',
			why_it_matters_th: 'มีความสำคัญ',
			background_th: null,
			uncertain_th: null,
			claims: [],
			category: 'geopolitics',
			regions: spec.regions ?? ['asia'],
			countries: [],
			tags: [],
			signals: spec.signals ?? { impact_breadth: 1, thailand_relevance: 1, sensitive: false },
			occurred_at: null,
			summarized_at: ingestedAt,
			status: 'published',
			review_reasons: [],
			new_updates: []
		},
		ingestedAt
	);
	return id;
}

async function runBriefJob(
	jobType: 'brief_morning' | 'brief_evening' | 'archive_snapshot',
	date: string,
	options: { force?: boolean; max?: number; now?: string } = {}
) {
	const edition: BriefEdition =
		jobType === 'brief_morning'
			? 'morning'
			: jobType === 'brief_evening'
				? 'evening'
				: 'daily_snapshot';
	const slot = jobType === 'archive_snapshot' ? archiveJobSlot(date) : briefJobSlot(jobType, date);
	const now = () => new Date(options.now ?? slot.scheduled_for);
	return runJob(
		{ jobs: repositories.jobs, logger: createJsonLogger(() => {}), now },
		{ job_type: jobType, ...slot, trigger: 'cron', force: options.force ?? false },
		(ctx) =>
			runBrief({ briefs: repositories.briefs, target: { min: 1, max: options.max ?? 15 } }, ctx, {
				date,
				edition
			})
	);
}

describe('acceptance #5: brief windows in Asia/Bangkok', () => {
	it('computes the ICT windows as UTC', () => {
		expect(briefWindow('2026-11-13', 'morning')).toMatchObject({
			start_utc: '2026-11-12T00:00:00.000Z',
			end_utc: '2026-11-13T00:00:00.000Z'
		});
		expect(briefWindow('2026-11-13', 'evening')).toMatchObject({
			start_utc: '2026-11-12T12:00:00.000Z',
			end_utc: '2026-11-13T12:00:00.000Z'
		});
		expect(briefWindow('2026-11-13', 'daily_snapshot')).toMatchObject({
			start_utc: '2026-11-12T17:00:00.000Z',
			end_utc: '2026-11-13T17:00:00.000Z'
		});
	});

	it('puts 23:59:59.999 ICT in the earlier day and 00:00 ICT in the next', async () => {
		const beforeMidnight = await publishedEvent({ publishedAt: '2026-11-12T16:59:59.999Z' });
		const atMidnight = await publishedEvent({ publishedAt: '2026-11-12T17:00:00.000Z' });
		const ids = async (window: { start_utc: string; end_utc: string }) =>
			(await repositories.briefs.listCandidateEvents(window)).map((candidate) => candidate.id);

		expect(await ids(briefWindow('2026-11-12', 'daily_snapshot'))).toEqual([beforeMidnight]);
		expect(await ids(briefWindow('2026-11-13', 'daily_snapshot'))).toEqual([atMidnight]);
		// Both fall in the morning brief of the 13th (12th 07:00 → 13th 07:00 ICT).
		expect((await ids(briefWindow('2026-11-13', 'morning'))).sort()).toEqual(
			[beforeMidnight, atMidnight].sort()
		);
	});
});

describe('acceptance #6: morning and evening briefs', () => {
	it('builds both editions for a date, idempotently, readable through the public repository', async () => {
		const overnight = await publishedEvent({ publishedAt: '2026-11-12T20:00:00.000Z' }); // 03:00 ICT
		const afternoon = await publishedEvent({ publishedAt: '2026-11-13T08:00:00.000Z' }); // 15:00 ICT

		const morning = await runBriefJob('brief_morning', '2026-11-13');
		const evening = await runBriefJob('brief_evening', '2026-11-13');
		expect(morning).toMatchObject({ status: 'succeeded', counters: { brief_events: 1 } });
		expect(evening).toMatchObject({ status: 'succeeded', counters: { brief_events: 2 } });

		expect(await runBriefJob('brief_morning', '2026-11-13')).toMatchObject({ status: 'skipped' });
		await runBriefJob('brief_evening', '2026-11-13', { force: true });
		expect(db.select().from(dailyBriefs).all()).toHaveLength(2);
		expect(db.select().from(dailyBriefEvents).all()).toHaveLength(3);

		const morningView = await repositories.read.getPublishedBrief('2026-11-13', 'morning');
		expect(morningView?.events.map((event) => event.id)).toEqual([overnight]);
		const best = await repositories.read.getPublishedBrief('2026-11-13');
		expect(best?.edition).toBe('evening');
		expect(best?.events.map((event) => event.id).sort()).toEqual([overnight, afternoon].sort());
		expect(best?.events.every((event) => event.selection_reason.length > 0)).toBe(true);
		expect(await repositories.read.getLatestPublishedBriefDate()).toBe('2026-11-13');
	});

	it('keeps an admin-hidden brief hidden when it is regenerated', async () => {
		await publishedEvent({ publishedAt: '2026-11-12T20:00:00.000Z' });
		await runBriefJob('brief_morning', '2026-11-13');
		db.update(dailyBriefs).set({ status: 'hidden' }).run();

		await publishedEvent({ publishedAt: '2026-11-12T21:00:00.000Z' });
		await runBriefJob('brief_morning', '2026-11-13', { force: true });

		const [brief] = db.select().from(dailyBriefs).all();
		expect(brief).toMatchObject({ status: 'hidden', event_count: 2 });
		expect(await repositories.read.getPublishedBrief('2026-11-13', 'morning')).toBeNull();
	});

	it('stores a brief with no eligible events as a draft', async () => {
		const result = await runBriefJob('brief_morning', '2026-11-13');
		expect(result).toMatchObject({ status: 'succeeded', counters: { brief_events: 0 } });
		expect(db.select().from(dailyBriefs).all()[0]?.status).toBe('draft');
	});

	it('leaves demo events out when real events are available', async () => {
		const real = await publishedEvent({ publishedAt: '2026-11-12T20:00:00.000Z' });
		await publishedEvent({ publishedAt: '2026-11-12T21:00:00.000Z', demo: true });
		await runBriefJob('brief_morning', '2026-11-13');

		const view = await repositories.read.getPublishedBrief('2026-11-13', 'morning');
		expect(view?.events.map((event) => event.id)).toEqual([real]);
	});
});

describe('archive_snapshot', () => {
	it('is idempotent and picks up a late report on a forced rerun', async () => {
		const sameDay = await publishedEvent({ publishedAt: '2026-11-12T03:00:00.000Z' });
		const first = await runBriefJob('archive_snapshot', '2026-11-12');
		expect(first).toMatchObject({ status: 'succeeded', counters: { brief_events: 1 } });
		expect(await runBriefJob('archive_snapshot', '2026-11-12')).toMatchObject({
			status: 'skipped'
		});

		// Published on the 12th, but only ingested two days later.
		const late = await publishedEvent({
			publishedAt: '2026-11-12T10:00:00.000Z',
			ingestedAt: '2026-11-14T02:00:00.000Z'
		});
		await runBriefJob('archive_snapshot', '2026-11-12', {
			force: true,
			now: '2026-11-14T03:00:00.000Z'
		});

		const snapshot = await repositories.read.getPublishedBrief('2026-11-12', 'daily_snapshot');
		expect(snapshot?.events.map((event) => event.id).sort()).toEqual([sameDay, late].sort());
		expect(db.select().from(dailyBriefs).all()).toHaveLength(1);
	});

	it('merges the events of the day’s morning and evening briefs', async () => {
		// In the morning brief of the 12th, but its evidence is from the 11th (ICT).
		const fromMorning = await publishedEvent({ publishedAt: '2026-11-11T13:00:00.000Z' });
		await runBriefJob('brief_morning', '2026-11-12');
		await runBriefJob('archive_snapshot', '2026-11-12');

		const snapshot = await repositories.read.getPublishedBrief('2026-11-12', 'daily_snapshot');
		expect(snapshot?.events.map((event) => event.id)).toEqual([fromMorning]);
	});
});

describe('rankBriefCandidates: region quota and selection reasons', () => {
	const candidate = (
		id: string,
		regions: RegionSlug[],
		impact: 0 | 1 | 2 | 3,
		extra: Partial<BriefCandidate> = {}
	): BriefCandidate => ({
		id,
		title_th: 'ข่าว',
		summary_th: 'สรุป',
		category: 'geopolitics',
		regions,
		countries: [],
		tags: [],
		event_date: '2026-11-13',
		occurred_at: null,
		last_updated_at: '2026-11-13T00:00:00.000Z',
		source_count: 1,
		is_demo: false,
		signals: { impact_breadth: impact, thailand_relevance: 0, sensitive: false },
		is_continuing: false,
		...extra
	});
	const windowEnd = '2026-11-13T00:00:00.000Z';

	it('keeps US/Europe at or below 40% when other regions have candidates', () => {
		// 12 high-scoring US/Europe stories and 3 weaker ones from elsewhere, for 10 slots.
		const dominant = Array.from({ length: 12 }, (_, index) =>
			candidate(`us-${index}`, [index % 2 === 0 ? 'americas' : 'europe'], 3)
		);
		const others = [
			candidate('africa', ['africa'], 1),
			candidate('sea', ['southeast-asia'], 1),
			candidate('mideast', ['middle-east'], 0)
		];
		const all = [...dominant, ...others];
		const items = rankBriefCandidates(all, { max: 10, windowEnd });

		expect(items).toHaveLength(10);
		const regionCount = (region: RegionSlug) =>
			items.filter((item) => all.find((c) => c.id === item.event_id)!.regions.includes(region))
				.length;
		expect(regionCount('americas')).toBeLessThanOrEqual(4);
		expect(regionCount('europe')).toBeLessThanOrEqual(4);
		expect(items.map((item) => item.event_id)).toEqual(expect.arrayContaining(['africa', 'sea']));
		expect(items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const africa = items.find((item) => item.event_id === 'africa')!;
		expect(africa.selection_reason).toContain('แอฟริกา');
	});

	it('lets the quota yield when there are no alternatives, and never pads', () => {
		const onlyUs = Array.from({ length: 3 }, (_, index) =>
			candidate(`us-${index}`, ['americas'], 2)
		);
		expect(rankBriefCandidates(onlyUs, { max: 15, windowEnd })).toHaveLength(3);
		expect(rankBriefCandidates([], { max: 15, windowEnd })).toEqual([]);
	});

	it('ranks by the PRD §4.4 signals and explains each pick in Thai', () => {
		const items = rankBriefCandidates(
			[
				candidate('minor', ['asia'], 0, { last_updated_at: '2026-11-12T00:00:00.000Z' }),
				candidate('major', ['asia'], 3, {
					source_count: 3,
					is_continuing: true,
					signals: { impact_breadth: 3, thailand_relevance: 3, sensitive: false }
				})
			],
			{ max: 15, windowEnd }
		);
		expect(items.map((item) => item.event_id)).toEqual(['major', 'minor']);
		expect(items[0]!.selection_reason).toBe(
			'ผลกระทบในวงกว้าง · เกี่ยวข้องกับประเทศไทยโดยตรง · เป็นเรื่องที่ติดตามต่อเนื่อง'
		);
		expect(items[1]!.selection_reason.length).toBeGreaterThan(0);
		expect(items.every((item) => /\p{Script=Thai}/u.test(item.selection_reason))).toBe(true);
	});
});
