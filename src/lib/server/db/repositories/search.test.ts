/**
 * Cost bounds of the public search on a multi-year events table (security review item 7). The
 * functional search cases on the demo data live in public-read.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEARCH_TOTAL_CAP, type SearchQuery } from '../../../types/views';
import type { Db } from '../client';
import { seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { MAX_QUERY_CODE_POINTS, MAX_SEARCH_TERMS, searchEvents, toSearchTerms } from './search';

const BULK_EVENTS = 20_000;
/** Lenient: the bounded queries take 15–60 ms on a dev laptop; unbounded ones took 100–600 ms. */
const QUERY_BUDGET_MS = 150;
const FILLER = 'รัฐบาลประกาศมาตรการใหม่เพื่อรับมือกับสถานการณ์เศรษฐกิจโลกที่ผันผวน '.repeat(10);

let db: Db;

beforeAll(() => {
	db = openTestDb();
	seedDatabase(db, []);
	seedBulkEvents(db, BULK_EVENTS);
}, 60_000);
afterAll(() => db.$client.close());

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

describe('toSearchTerms', () => {
	it('dedupes terms case-insensitively and keeps the first five', () => {
		expect(toSearchTerms('  AI ai Ai ชิป  ')).toEqual(['AI', 'ชิป']);
		expect(toSearchTerms('a b a c d e f')).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(toSearchTerms('ซ '.repeat(50))).toEqual(['ซ']);
		expect(MAX_SEARCH_TERMS).toBe(5);
	});

	it('reads only the first 100 code points', () => {
		// An astral character is two UTF-16 units but one code point.
		const astral = String.fromCodePoint(0x1d4b3);
		const [term] = toSearchTerms(astral.repeat(150));
		expect([...(term ?? '')]).toHaveLength(MAX_QUERY_CODE_POINTS);
		expect(toSearchTerms(`${'x'.repeat(100)} hidden`)).toEqual(['x'.repeat(100)]);
	});
});

describe(`searchEvents on ${BULK_EVENTS} published events`, () => {
	it.each([
		['a broad FTS term', 'ข่าว'],
		['one short term', 'ก'],
		['50 short terms with no match', 'ซ '.repeat(50).trim()],
		['50 short terms that all match', 'ก '.repeat(50).trim()],
		['33 short terms with no match', 'zz '.repeat(33).trim()],
		['5 broad terms plus a duplicate', 'ข่าว รัฐบาล ประกาศ มาตรการ เศรษฐกิจ ข่าว'],
		[
			'5 long broad phrases',
			'รัฐบาลประกาศมาตรการใหม่เพื่อรับมือ ประกาศมาตรการใหม่ สถานการณ์เศรษฐกิจโลก ใหม่เพื่อรับมือ ทดสอบ'
		],
		['long and short terms mixed', 'ข่าว ก ข zz ค']
	])('stays within the time budget for %s', (_label, q) => {
		searchEvents(db, query(q)); // warm the statement cache
		const started = performance.now();
		searchEvents(db, query(q));
		expect(performance.now() - started).toBeLessThan(QUERY_BUDGET_MS);
	});

	it('stays within the time budget when a filter rejects every bulk event', () => {
		// The bulk events are `technology` / `global` (cloned from demo-evt-12).
		const filters: Partial<SearchQuery>[] = [{ region: 'africa' }, { category: 'society' }];
		for (const overrides of filters) {
			for (const q of ['ข่าว', 'ก']) {
				searchEvents(db, query(q, overrides));
				const started = performance.now();
				const result = searchEvents(db, query(q, overrides));
				expect(performance.now() - started).toBeLessThan(QUERY_BUDGET_MS);
				expect(result.items.some((event) => event.id.startsWith('bulk-'))).toBe(false);
			}
		}
	});

	it('stops counting past the cap and still serves the deepest page', () => {
		const first = searchEvents(db, query('ข่าว'));
		expect(first.total).toBe(SEARCH_TOTAL_CAP + 1);
		expect(first.items).toHaveLength(20);

		const deepest = searchEvents(db, query('ข่าว', { offset: SEARCH_TOTAL_CAP - 20 }));
		expect(deepest.total).toBe(SEARCH_TOTAL_CAP + 1);
		expect(deepest.items).toHaveLength(20);
	});

	it('ignores duplicate terms and every term after the fifth', () => {
		const single = searchEvents(db, query('ข่าว'));
		expect(searchEvents(db, query('ข่าว ข่าว ข่าว'))).toEqual(single);
		// The sixth term would match nothing; it is dropped, so the five broad terms still match.
		const sixTerms = searchEvents(db, query('ข่าว รัฐบาล ประกาศ มาตรการ เศรษฐกิจ zzzz'));
		expect(sixTerms.total).toBe(SEARCH_TOTAL_CAP + 1);
	});

	it('applies short terms with LIKE over the FTS-narrowed rows', () => {
		const result = searchEvents(db, query('ทดสอบ 19'));
		expect(result.items.length).toBeGreaterThan(0);
		for (const event of result.items) expect(event.title_th).toContain('19');
		expect(searchEvents(db, query('ทดสอบ zz'))).toEqual({ items: [], total: 0 });
	});
});

/**
 * Clones one demo published event (with its stored source) `count` times in one transaction,
 * with long Thai bodies so FTS phrase checks and LIKE scans do realistic work.
 */
function seedBulkEvents(target: Db, count: number): void {
	const client = target.$client;
	const event = client
		.prepare("SELECT * FROM events WHERE status = 'published' LIMIT 1")
		.get() as Record<string, unknown>;
	const article = client.prepare('SELECT * FROM articles LIMIT 1').get() as Record<string, unknown>;
	const link = client.prepare('SELECT * FROM event_articles LIMIT 1').get() as Record<
		string,
		unknown
	>;
	const insertEvent = insertStatementFor('events', event);
	const insertArticle = insertStatementFor('articles', article);
	const insertLink = insertStatementFor('event_articles', link);

	client.transaction(() => {
		for (let i = 0; i < count; i++) {
			insertEvent.run({
				...event,
				id: `bulk-ev-${i}`,
				title_th: `ข่าวทดสอบ ${i}`,
				what_happened_th: FILLER,
				why_it_matters_th: FILLER,
				background_th: FILLER
			});
			insertArticle.run({
				...article,
				id: `bulk-ar-${i}`,
				canonical_url: `https://example.com/bulk/${i}`,
				content_hash: `bulk-hash-${i}`
			});
			insertLink.run({ ...link, event_id: `bulk-ev-${i}`, article_id: `bulk-ar-${i}` });
		}
	})();

	function insertStatementFor(table: string, template: Record<string, unknown>) {
		const columns = Object.keys(template);
		return client.prepare(
			`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`
		);
	}
}
