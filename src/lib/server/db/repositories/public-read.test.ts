import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLessonFiles, toAcademyLessonRows } from '../../../content/academy.server';
import type { SearchQuery } from '../../../types/views';
import type { Db } from '../client';
import { articles } from '../schema';
import { seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { createRepositories } from './index';

let db: Db;
let read: ReturnType<typeof createRepositories>['read'];

beforeAll(() => {
	db = openTestDb();
	seedDatabase(db, toAcademyLessonRows(readLessonFiles().lessons));
	read = createRepositories(db).read;
});
afterAll(() => db.$client.close());

const PENDING_EVENT = 'demo-evt-13';

const query = (q: string, overrides: Partial<SearchQuery> = {}): SearchQuery => ({
	q,
	scope: 'all',
	category: null,
	region: null,
	from: null,
	to: null,
	limit: 20,
	offset: 0,
	...overrides
});

describe('briefs', () => {
	it('finds the latest brief date and the best edition per date', async () => {
		expect(await read.getLatestPublishedBriefDate()).toBe('2026-11-13');
		expect((await read.getPublishedBrief('2026-11-12'))?.edition).toBe('daily_snapshot');
		expect((await read.getPublishedBrief('2026-11-12', 'morning'))?.edition).toBe('morning');
		expect(await read.getPublishedBrief('2026-11-13', 'evening')).toBeNull();
		expect(await read.listPublishedEditions('2026-11-11')).toEqual([
			'morning',
			'evening',
			'daily_snapshot'
		]);
	});

	it('returns ranked items with selection reasons and never the pending event', async () => {
		const brief = await read.getPublishedBrief('2026-11-13', 'morning');
		expect(brief?.events.map((event) => event.rank)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(brief?.events[0]).toMatchObject({ id: 'demo-evt-01', is_demo: true });
		expect(brief?.events.every((event) => event.selection_reason.length > 0)).toBe(true);
		expect(brief?.events.some((event) => event.id === PENDING_EVENT)).toBe(false);
	});

	it('navigates dates', async () => {
		expect(await read.getAdjacentBriefDates('2026-11-12')).toEqual({
			prev: '2026-11-11',
			next: '2026-11-13'
		});
		expect(await read.getAdjacentBriefDates('2026-11-10')).toEqual({
			prev: null,
			next: '2026-11-11'
		});
		expect(await read.listBriefDatesInMonth('2026-11')).toEqual([
			'2026-11-10',
			'2026-11-11',
			'2026-11-12',
			'2026-11-13'
		]);
		expect(await read.listBriefDatesInMonth('2026-10')).toEqual([]);
	});
});

describe('event detail', () => {
	it('returns sources from stored articles, updates, relations, lessons and appearances', async () => {
		const event = await read.getPublishedEventDetail('demo-evt-01');

		expect(event).not.toBeNull();
		expect(event?.sources.map((source) => source.url)).toEqual([
			'https://example.com/demo/demo-wire-a/demo-art-01a',
			'https://example.com/demo/demo-wire-b/demo-art-01b',
			'https://example.com/demo/demo-wire-c/demo-art-01c'
		]);
		expect(event?.source_count).toBe(3);
		expect(event?.claims[0]?.evidence_source_urls).toEqual([
			'https://example.com/demo/demo-wire-a/demo-art-01a'
		]);
		expect(event?.updates).toHaveLength(1);
		expect(event?.relations.map((relation) => relation.relation_type).sort()).toEqual([
			'follow_up',
			'response_to'
		]);
		expect(event?.lessons.map((lesson) => lesson.id)).toEqual(['w1-d07', 'w3-d18']);
		expect(event?.brief_appearances).toEqual([{ brief_date: '2026-11-13', edition: 'morning' }]);
	});

	it('marks potential_impact relations as reviewed and lists public corrections', async () => {
		const energy = await read.getPublishedEventDetail('demo-evt-04');
		const impact = energy?.relations.find(
			(relation) => relation.relation_type === 'potential_impact'
		);
		expect(impact).toMatchObject({ reviewed: true, to_event_id: 'demo-evt-02' });
		expect(impact?.evidence_source_urls.length).toBeGreaterThan(0);

		const currency = await read.getPublishedEventDetail('demo-evt-08');
		expect(currency?.corrections).toHaveLength(1);
	});

	it('shows the single-source label data and hides the pending event entirely', async () => {
		expect((await read.getPublishedEventDetail('demo-evt-05'))?.source_count).toBe(1);
		expect(await read.getPublishedEventDetail(PENDING_EVENT)).toBeNull();
		expect(await read.getPublishedEventDetail('does-not-exist')).toBeNull();
	});

	it('hides relations that are pending or point at a non-public event', async () => {
		const relations = await read.listPublishedRelations({
			since: '2026-11-01T00:00:00.000Z',
			category: null,
			limit: 50
		});
		const ids = relations.map((relation) => relation.id).sort();
		expect(ids).toEqual([
			'demo-rel-01',
			'demo-rel-02',
			'demo-rel-03',
			'demo-rel-04',
			'demo-rel-05'
		]);

		const energyOnly = await read.listPublishedRelations({
			since: '2026-11-01T00:00:00.000Z',
			category: 'energy',
			limit: 50
		});
		expect(energyOnly.map((relation) => relation.id).sort()).toEqual([
			'demo-rel-03',
			'demo-rel-04'
		]);
	});

	it('lists lesson-related events without the pending event', async () => {
		expect(await read.listPublishedEventsForLesson('w3-d15', 5)).toEqual([]);
		const related = await read.listPublishedEventsForLesson('w3-d20', 5);
		expect(related.map((event) => event.id).sort()).toEqual(['demo-evt-07', 'demo-evt-12']);
	});
});

describe('freshness and demo flags', () => {
	it('reports the latest published brief and no successful ingest yet', async () => {
		expect(await read.getFreshnessTimestamps()).toEqual({
			last_ingest_succeeded_at: null,
			last_brief_published_at: '2026-11-13T00:00:00.000Z'
		});
		expect(await read.hasPublishedDemoContent()).toBe(true);
		await expect(read.ping()).resolves.toBeUndefined();
	});
});

describe('search (FTS5 trigram, LIKE fallback under 3 characters)', () => {
	it('finds a Thai substring of 3+ characters through FTS', async () => {
		// "อุปทาน" appears inside "ห่วงโซ่อุปทานชิป" (demo-evt-07); no word boundaries needed.
		const result = await read.searchEvents(query('อุปทาน'));
		expect(result.items.map((event) => event.id)).toContain('demo-evt-07');
		expect(result.total).toBe(result.items.length);
	});

	it('finds a 2-character Thai query through the LIKE fallback', async () => {
		// "ชิ" (2 code points) is too short for trigram; LIKE still matches "ชิป".
		const result = await read.searchEvents(query('ชิ'));
		expect(result.items.map((event) => event.id)).toEqual(
			expect.arrayContaining(['demo-evt-01', 'demo-evt-07', 'demo-evt-12'])
		);
	});

	it('searches tags and applies category, region and date filters', async () => {
		expect((await read.searchEvents(query('semiconductors'))).total).toBeGreaterThanOrEqual(3);
		const filtered = await read.searchEvents(
			query('semiconductors', { category: 'technology', region: 'asia', from: '2026-11-12' })
		);
		expect(filtered.items.map((event) => event.id)).toEqual(['demo-evt-07']);
	});

	it('never returns the pending event and treats FTS syntax as text', async () => {
		const pending = await read.searchEvents(query('ชายแดน'));
		expect(pending.items.some((event) => event.id === PENDING_EVENT)).toBe(false);
		await expect(read.searchEvents(query('"OR* NEAR('))).resolves.toEqual({ items: [], total: 0 });
		await expect(read.searchEvents(query('100%'))).resolves.toEqual({ items: [], total: 0 });
	});

	it('pages results with limit and offset', async () => {
		const all = await read.searchEvents(query('ตัวอย่าง'));
		const page = await read.searchEvents(query('ตัวอย่าง', { limit: 2, offset: 2 }));
		expect(page.total).toBe(all.total);
		expect(page.items).toEqual(all.items.slice(2, 4));
	});

	it('searches lesson titles and bodies, with the LIKE fallback too', async () => {
		const fts = await read.searchLessons(query('เงินเฟ้อ'));
		expect(fts.items.map((lesson) => lesson.id)).toContain('w2-d09');

		const short = await read.searchLessons(query('UN'));
		expect(short.items.map((lesson) => lesson.id)).toContain('w1-d06');

		const economy = await read.searchLessons(query('เงินเฟ้อ', { category: 'economy' }));
		expect(economy.items.every((lesson) => lesson.related_categories.includes('economy'))).toBe(
			true
		);
	});
});

describe('excerpts stay internal (PRD §4.2)', () => {
	const EXCERPT = 'Zyxwv internal excerpt marker for the export-control story.';

	beforeAll(() => {
		db.update(articles).set({ excerpt: EXCERPT }).where(eq(articles.id, 'demo-art-01a')).run();
	});

	it('leaves the excerpt out of the public event detail, brief and search results', async () => {
		const detail = await read.getPublishedEventDetail('demo-evt-01');
		const brief = await read.getPublishedBrief('2026-11-13', 'morning');
		const search = await read.searchEvents(query('ชิ'));

		expect(detail?.sources.map((source) => source.article_id)).toContain('demo-art-01a');
		expect(search.items.map((event) => event.id)).toContain('demo-evt-01');
		for (const payload of [detail, brief, search]) {
			const json = JSON.stringify(payload);
			expect(json).not.toContain('Zyxwv');
			expect(json).not.toContain('"excerpt"');
		}
	});

	it('does not match excerpt-only words in search', async () => {
		expect(await read.searchEvents(query('Zyxwv'))).toEqual({ items: [], total: 0 });
	});
});
