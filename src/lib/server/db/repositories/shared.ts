/**
 * Building blocks shared by the repository implementations: the executor type, row → view
 * mappers, the "publicly visible event" predicate, and evidence-URL resolution.
 */
import type { RunResult } from 'better-sqlite3';
import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { BaseSQLiteDatabase, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { EvidenceRef, JsonObject } from '../../../types/domain';
import type { EventSummary, LessonSummary } from '../../../types/views';
import * as schema from '../schema';
import { academyLessons, articles, events } from '../schema';

/** The database or an open transaction (both are synchronous better-sqlite3 executors). */
export type Executor = BaseSQLiteDatabase<'sync', RunResult, typeof schema>;

export type EventRow = typeof events.$inferSelect;
export type LessonRow = typeof academyLessons.$inferSelect;

export class EntityNotFoundError extends Error {
	override name = 'EntityNotFoundError';
	constructor(entity: string, id: string) {
		super(`${entity} ${id} not found`);
	}
}

/**
 * Publicly visible event: published and categorized (publish gate G2 guarantees a category, the
 * second condition keeps the `EventSummary.category` type honest). Works on aliased tables too.
 */
export function isPublicEvent(table: { status: SQLiteColumn; category: SQLiteColumn }): SQL {
	return and(eq(table.status, 'published'), isNotNull(table.category)) as SQL;
}

export function toEventSummary(row: EventRow): EventSummary {
	if (row.category === null) {
		throw new Error(`event ${row.id} has no category and cannot be shown publicly`);
	}
	return {
		id: row.id,
		title_th: row.title_th,
		summary_th: row.summary_th,
		category: row.category,
		regions: row.regions,
		countries: row.countries,
		tags: row.tags,
		event_date: row.event_date,
		occurred_at: row.occurred_at,
		last_updated_at: row.last_updated_at,
		source_count: row.source_count,
		is_demo: row.is_demo
	};
}

export function toLessonSummary(row: LessonRow): LessonSummary {
	return {
		id: row.id,
		week: row.week,
		day: row.day,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		related_categories: row.categories
	};
}

/** article_id → canonical_url for every stored article referenced by `refs`. */
export function loadEvidenceUrls(db: Executor, refs: EvidenceRef[]): Map<string, string> {
	const ids = [...new Set(refs.map((ref) => ref.article_id))];
	if (ids.length === 0) return new Map();

	const rows = db
		.select({ id: articles.id, url: articles.canonical_url })
		.from(articles)
		.where(inArray(articles.id, ids))
		.all();
	return new Map(rows.map((row) => [row.id, row.url]));
}

/**
 * Plain JSON copy for `content_revisions.before_after`. Domain interfaces have no index signature,
 * so they are not assignable to `JsonObject` without this round trip (which also drops `undefined`).
 */
export function toJsonObject(value: object): JsonObject {
	return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/**
 * URLs come only from stored articles; refs that do not resolve are dropped, and each URL appears
 * once (first occurrence wins), so the UI can key links by URL.
 */
export function evidenceUrls(refs: EvidenceRef[], urlByArticleId: Map<string, string>): string[] {
	const urls = refs
		.map((ref) => urlByArticleId.get(ref.article_id))
		.filter((url): url is string => url !== undefined);
	return [...new Set(urls)];
}
