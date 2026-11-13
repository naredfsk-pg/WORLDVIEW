/**
 * Search over published events and lessons (FR-05).
 *
 * FTS5 with the `trigram` tokenizer matches any substring of 3+ characters, which is what Thai
 * needs (no word boundaries). Trigram cannot match shorter strings, so when any whitespace-separated
 * term is shorter than 3 characters (code points) the query falls back to `LIKE '%term%'`.
 * All user input is bound as parameters; FTS terms are quoted as phrases so FTS syntax in the
 * query is treated as text.
 */
import { and, asc, count, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { real, sqliteTable, text, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { EventSummary, LessonSummary, SearchQuery } from '../../../types/views';
import { academyLessons, events } from '../schema';
import { isPublicEvent, toEventSummary, toLessonSummary, type Executor } from './shared';

/** Minimum term length (in code points) the trigram tokenizer can match. */
export const MIN_FTS_TERM_LENGTH = 3;

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
	const terms = splitTerms(query.q);
	if (terms.length === 0) return { items: [], total: 0 };

	const filters = and(
		isPublicEvent(events),
		query.category ? eq(events.category, query.category) : undefined,
		query.region
			? sql`EXISTS (SELECT 1 FROM json_each(${events.regions}) WHERE value = ${query.region})`
			: undefined,
		query.from ? gte(events.event_date, query.from) : undefined,
		query.to ? lte(events.event_date, query.to) : undefined
	);

	if (canUseFts(terms)) {
		const where = and(filters, sql`${eventsFts} MATCH ${toFtsMatch(terms)}`);
		const total = tx
			.select({ total: count() })
			.from(eventsFts)
			.innerJoin(events, eq(events.id, eventsFts.event_id))
			.where(where)
			.get();
		const rows = tx
			.select({ event: events })
			.from(eventsFts)
			.innerJoin(events, eq(events.id, eventsFts.event_id))
			.where(where)
			.orderBy(asc(eventsFts.rank), desc(events.last_updated_at))
			.limit(query.limit)
			.offset(query.offset)
			.all();
		return { items: rows.map((row) => toEventSummary(row.event)), total: total?.total ?? 0 };
	}

	const where = and(filters, likeAllTerms(terms, EVENT_TEXT_COLUMNS));
	const total = tx.select({ total: count() }).from(events).where(where).get();
	const rows = tx
		.select()
		.from(events)
		.where(where)
		.orderBy(desc(events.last_updated_at))
		.limit(query.limit)
		.offset(query.offset)
		.all();
	return { items: rows.map(toEventSummary), total: total?.total ?? 0 };
}

/** Lessons ignore `region` and the date range (they have neither). */
export function searchLessons(
	tx: Executor,
	query: SearchQuery
): { items: LessonSummary[]; total: number } {
	const terms = splitTerms(query.q);
	if (terms.length === 0) return { items: [], total: 0 };

	const categoryFilter = query.category
		? sql`EXISTS (SELECT 1 FROM json_each(${academyLessons.categories}) WHERE value = ${query.category})`
		: undefined;

	if (canUseFts(terms)) {
		const where = and(categoryFilter, sql`${lessonsFts} MATCH ${toFtsMatch(terms)}`);
		const total = tx
			.select({ total: count() })
			.from(lessonsFts)
			.innerJoin(academyLessons, eq(academyLessons.id, lessonsFts.lesson_id))
			.where(where)
			.get();
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

	const where = and(categoryFilter, likeAllTerms(terms, LESSON_TEXT_COLUMNS));
	const total = tx.select({ total: count() }).from(academyLessons).where(where).get();
	const rows = tx
		.select()
		.from(academyLessons)
		.where(where)
		.orderBy(asc(academyLessons.day))
		.limit(query.limit)
		.offset(query.offset)
		.all();
	return { items: rows.map(toLessonSummary), total: total?.total ?? 0 };
}

function splitTerms(q: string): string[] {
	return q.trim().split(/\s+/u).filter(Boolean);
}

function canUseFts(terms: string[]): boolean {
	return terms.every((term) => [...term].length >= MIN_FTS_TERM_LENGTH);
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
