/**
 * Search over published events and lessons (FR-05).
 *
 * FTS5 with the `trigram` tokenizer matches any substring of 3+ characters, which is what Thai
 * needs (no word boundaries). Trigram cannot match shorter strings, so terms shorter than 3
 * characters (code points) are matched with `LIKE '%term%'` instead, over rows already narrowed
 * by FTS (the longer terms) or, when every term is short, over the newest events only.
 * All user input is bound as parameters; FTS terms are quoted as phrases so FTS syntax in the
 * query is treated as text.
 *
 * Cost bounds (/search is public and SQLite blocks the event loop):
 * - at most MAX_SEARCH_TERMS distinct terms from the first MAX_QUERY_CODE_POINTS code points;
 * - events are matched within a window of the EVENT_CANDIDATE_LIMIT newest candidates, and are
 *   ordered by recency, not bm25: bm25 has to read every match of every phrase, which on a broad
 *   term over a year of events costs hundreds of milliseconds;
 * - totals stop counting past SEARCH_TOTAL_CAP (the page shows "1000+").
 */
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { real, sqliteTable, text, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
	SEARCH_TOTAL_CAP,
	type EventSummary,
	type LessonSummary,
	type SearchQuery
} from '../../../types/views';
import { academyLessons, events } from '../schema';
import { isReadableEvent, toEventSummary, toLessonSummary, type Executor } from './shared';

/** Minimum term length (in code points) the trigram tokenizer can match. */
export const MIN_FTS_TERM_LENGTH = 3;
/** Distinct terms used from one query; later terms are ignored. */
export const MAX_SEARCH_TERMS = 5;
/** Defence in depth: the route already cuts `q` to 100 characters. */
export const MAX_QUERY_CODE_POINTS = 100;
/**
 * Newest events (FTS rowid for long terms, `last_updated_at` otherwise) that are matched against
 * the query. Twice the deepest reachable result (50 pages × 20), so paging never runs out first.
 */
export const EVENT_CANDIDATE_LIMIT = 2000;

// FTS5 virtual tables created by migrations/0001_fts.sql. Declared here (not in schema.ts) so
// drizzle-kit never tries to manage them. `rank` is FTS5's hidden bm25 column.
const eventsFts = sqliteTable('events_fts', { event_id: text().notNull(), rank: real() });
const lessonsFts = sqliteTable('lessons_fts', { lesson_id: text().notNull(), rank: real() });

const EVENT_TEXT_COLUMNS = [
	events.title_th,
	events.summary_th,
	events.what_happened_th,
	events.why_it_matters_th,
	events.background_th,
	events.tags
];
const LESSON_TEXT_COLUMNS = [
	academyLessons.title,
	academyLessons.summary,
	academyLessons.search_text
];

export function searchEvents(
	tx: Executor,
	query: SearchQuery
): { items: EventSummary[]; total: number } {
	const terms = toSearchTerms(query.q);
	if (terms.length === 0) return { items: [], total: 0 };
	const { ftsTerms, likeTerms } = splitByLength(terms);

	const filters = and(
		isReadableEvent(events),
		query.category ? eq(events.category, query.category) : undefined,
		query.region
			? sql`EXISTS (SELECT 1 FROM json_each(${events.regions}) WHERE value = ${query.region})`
			: undefined,
		query.from ? gte(events.event_date, query.from) : undefined,
		query.to ? lte(events.event_date, query.to) : undefined
	);

	// The window is read straight from an index and stops after EVENT_CANDIDATE_LIMIT rows however
	// broad the terms or narrow the filters: FTS matches newest-indexed first (rowid DESC; a
	// reindexed event gets a new rowid), otherwise the newest events by `last_updated_at`. The
	// filters and LIKE terms then run on those rows only, so a broad term or an all-short query
	// misses older events; unpublished rows also take window slots.
	const candidates =
		ftsTerms.length > 0
			? tx
					.select({ id: eventsFts.event_id })
					.from(eventsFts)
					.where(sql`${eventsFts} MATCH ${toFtsMatch(ftsTerms)}`)
					.orderBy(desc(sql`${eventsFts}.rowid`))
					.limit(EVENT_CANDIDATE_LIMIT)
			: tx
					.select({ id: events.id })
					.from(events)
					.orderBy(desc(events.last_updated_at))
					.limit(EVENT_CANDIDATE_LIMIT);

	// One pass over the window: at most EVENT_CANDIDATE_LIMIT ids, newest first.
	const matches = tx
		.select({ id: events.id })
		.from(events)
		.where(
			and(inArray(events.id, candidates), filters, likeAllTerms(likeTerms, EVENT_TEXT_COLUMNS))
		)
		.orderBy(desc(events.last_updated_at), asc(events.id))
		.all();
	const pageIds = matches.slice(query.offset, query.offset + query.limit).map((row) => row.id);
	const rows =
		pageIds.length === 0
			? []
			: tx
					.select()
					.from(events)
					.where(inArray(events.id, pageIds))
					.orderBy(desc(events.last_updated_at), asc(events.id))
					.all();
	return {
		items: rows.map(toEventSummary),
		total: Math.min(matches.length, SEARCH_TOTAL_CAP + 1)
	};
}

/**
 * Lessons ignore `region` and the date range (they have neither). The table is the fixed 30-day
 * course, so it needs no candidate window and keeps bm25 ranking.
 */
export function searchLessons(
	tx: Executor,
	query: SearchQuery
): { items: LessonSummary[]; total: number } {
	const terms = toSearchTerms(query.q);
	if (terms.length === 0) return { items: [], total: 0 };
	const { ftsTerms, likeTerms } = splitByLength(terms);

	const filters = and(
		query.category
			? sql`EXISTS (SELECT 1 FROM json_each(${academyLessons.categories}) WHERE value = ${query.category})`
			: undefined,
		likeAllTerms(likeTerms, LESSON_TEXT_COLUMNS)
	);

	if (ftsTerms.length > 0) {
		const where = and(filters, sql`${lessonsFts} MATCH ${toFtsMatch(ftsTerms)}`);
		const capped = tx
			.select({ id: lessonsFts.lesson_id })
			.from(lessonsFts)
			.innerJoin(academyLessons, eq(academyLessons.id, lessonsFts.lesson_id))
			.where(where)
			.limit(SEARCH_TOTAL_CAP + 1)
			.as('capped');
		const total = tx.select({ total: count() }).from(capped).get();
		const rows = tx
			.select({ lesson: academyLessons })
			.from(lessonsFts)
			.innerJoin(academyLessons, eq(academyLessons.id, lessonsFts.lesson_id))
			.where(where)
			.orderBy(asc(lessonsFts.rank), asc(academyLessons.day))
			.limit(query.limit)
			.offset(query.offset)
			.all();
		return { items: rows.map((row) => toLessonSummary(row.lesson)), total: total?.total ?? 0 };
	}

	const capped = tx
		.select({ id: academyLessons.id })
		.from(academyLessons)
		.where(filters)
		.limit(SEARCH_TOTAL_CAP + 1)
		.as('capped');
	const total = tx.select({ total: count() }).from(capped).get();
	const rows = tx
		.select()
		.from(academyLessons)
		.where(filters)
		.orderBy(asc(academyLessons.day))
		.limit(query.limit)
		.offset(query.offset)
		.all();
	return { items: rows.map(toLessonSummary), total: total?.total ?? 0 };
}

/**
 * Whitespace-separated terms of the first MAX_QUERY_CODE_POINTS code points, deduplicated
 * case-insensitively, at most MAX_SEARCH_TERMS. Exported for tests.
 */
export function toSearchTerms(q: string): string[] {
	const head = [...q].slice(0, MAX_QUERY_CODE_POINTS).join('');
	const seen = new Set<string>();
	const terms: string[] = [];
	for (const term of head.trim().split(/\s+/u)) {
		const key = term.toLowerCase();
		if (!term || seen.has(key)) continue;
		seen.add(key);
		terms.push(term);
		if (terms.length === MAX_SEARCH_TERMS) break;
	}
	return terms;
}

function splitByLength(terms: string[]): { ftsTerms: string[]; likeTerms: string[] } {
	const isLong = (term: string) => [...term].length >= MIN_FTS_TERM_LENGTH;
	return {
		ftsTerms: terms.filter(isLong),
		likeTerms: terms.filter((term) => !isLong(term))
	};
}

/** `"term one" AND "term two"`: each term is a quoted phrase, so FTS operators in input are inert. */
function toFtsMatch(terms: string[]): string {
	return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

/** Every term must appear (as a substring) in at least one of the columns. */
function likeAllTerms(terms: string[], columns: SQLiteColumn[]): SQL | undefined {
	return and(
		...terms.map((term) => {
			const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
			return or(...columns.map((column) => sql`${column} LIKE ${pattern} ESCAPE '\\'`));
		})
	);
}
