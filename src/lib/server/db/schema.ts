/**
 * Drizzle schema: PRD §7 tables plus the ARCHITECTURE §5 additions (`llm_calls`, renamed/added fields).
 * Column names, nullability and JSON shapes mirror `src/lib/types/*.ts` exactly, so `$inferSelect`
 * rows are the domain types. FTS5 tables and their sync triggers live in a custom migration
 * (`migrations/0001_*_fts.sql`) because Drizzle cannot express virtual tables.
 *
 * Storage rules (ARCHITECTURE §5): TEXT ids, TEXT UTC ISO timestamps, JSON as TEXT, FKs on.
 * Relative imports (not `#lib/...`) keep this file loadable by drizzle-kit.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex,
	type SQLiteColumn
} from 'drizzle-orm/sqlite-core';
import {
	ADMIN_ACTION_TYPES,
	BRIEF_EDITIONS,
	BRIEF_STATUSES,
	CATEGORY_SLUGS,
	EVENT_STATUSES,
	RELATION_STATUSES,
	RELATION_TYPES,
	REVISION_ENTITY_TYPES,
	SOURCE_KINDS,
	type ArticleTaxonomy,
	type AttributedClaim,
	type CategorySlug,
	type ContentRevision,
	type CountryCode,
	type EditorialSignals,
	type EvidenceRef,
	type JsonObject,
	type RegionSlug,
	type ReviewReason,
	type Tag
} from '../../types/domain';
import { JOB_STATUSES, JOB_TRIGGERS, JOB_TYPES, type JobCounters } from '../../types/jobs';
import { LLM_ERROR_KINDS, LLM_TASKS } from '../../types/llm';

// ---------------------------------------------------------------------------
// sources / articles
// ---------------------------------------------------------------------------

export const sources = sqliteTable(
	'sources',
	{
		id: text().primaryKey(),
		name: text().notNull(),
		kind: text({ enum: SOURCE_KINDS }).notNull(),
		homepage_url: text().notNull(),
		feed_url: text().notNull(),
		license_notes: text().notNull(),
		allow_excerpt: integer({ mode: 'boolean' }).notNull(),
		is_demo: integer({ mode: 'boolean' }).notNull(),
		enabled: integer({ mode: 'boolean' }).notNull(),
		last_success_at: text(),
		last_error_at: text(),
		last_error: text()
	},
	(t) => [check('sources_kind_check', inList(t.kind, SOURCE_KINDS))]
);

export const articles = sqliteTable(
	'articles',
	{
		id: text().primaryKey(),
		source_id: text()
			.notNull()
			.references(() => sources.id),
		source_url: text().notNull(),
		canonical_url: text().notNull(),
		publisher_name: text().notNull(),
		title: text().notNull(),
		excerpt: text(),
		language: text(),
		published_at: text(),
		ingested_at: text().notNull(),
		content_hash: text().notNull(),
		raw_metadata: text({ mode: 'json' }).$type<JsonObject>().notNull(),
		taxonomy: text({ mode: 'json' }).$type<ArticleTaxonomy>()
	},
	(t) => [
		uniqueIndex('articles_canonical_url_unique').on(t.canonical_url),
		index('articles_content_hash_idx').on(t.content_hash),
		index('articles_published_at_idx').on(t.published_at),
		index('articles_ingested_at_idx').on(t.ingested_at),
		index('articles_source_id_idx').on(t.source_id)
	]
);

// ---------------------------------------------------------------------------
// events and their edges
// ---------------------------------------------------------------------------

export const events = sqliteTable(
	'events',
	{
		id: text().primaryKey(),
		status: text({ enum: EVENT_STATUSES }).notNull(),
		review_reasons: text({ mode: 'json' }).$type<ReviewReason[]>().notNull(),
		title_th: text().notNull(),
		summary_th: text().notNull(),
		what_happened_th: text().notNull(),
		why_it_matters_th: text().notNull(),
		background_th: text(),
		uncertain_th: text(),
		claims: text({ mode: 'json' }).$type<AttributedClaim[]>().notNull(),
		category: text({ enum: CATEGORY_SLUGS }).$type<CategorySlug>(),
		regions: text({ mode: 'json' }).$type<RegionSlug[]>().notNull(),
		countries: text({ mode: 'json' }).$type<CountryCode[]>().notNull(),
		tags: text({ mode: 'json' }).$type<Tag[]>().notNull(),
		signals: text({ mode: 'json' }).$type<EditorialSignals>(),
		occurred_at: text(),
		first_seen_at: text().notNull(),
		event_date: text().notNull(),
		last_updated_at: text().notNull(),
		published_at: text(),
		summarized_at: text(),
		source_count: integer().notNull(),
		is_demo: integer({ mode: 'boolean' }).notNull(),
		created_at: text().notNull(),
		updated_at: text().notNull()
	},
	(t) => [
		index('events_status_event_date_idx').on(t.status, t.event_date),
		index('events_category_idx').on(t.category),
		index('events_last_updated_at_idx').on(t.last_updated_at),
		check('events_status_check', inList(t.status, EVENT_STATUSES)),
		check(
			'events_category_check',
			sql`${t.category} IS NULL OR ${inList(t.category, CATEGORY_SLUGS)}`
		),
		check('events_source_count_check', sql`${t.source_count} >= 0`)
	]
);

export const eventArticles = sqliteTable(
	'event_articles',
	{
		event_id: text()
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		article_id: text()
			.notNull()
			.references(() => articles.id, { onDelete: 'cascade' }),
		relation_confidence: real().notNull(),
		linked_at: text().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.event_id, t.article_id] }),
		// An article belongs to at most one event.
		uniqueIndex('event_articles_article_id_unique').on(t.article_id)
	]
);

export const eventUpdates = sqliteTable(
	'event_updates',
	{
		id: text().primaryKey(),
		event_id: text()
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		occurred_at: text(),
		reported_at: text().notNull(),
		update_text_th: text().notNull(),
		evidence_refs: text({ mode: 'json' }).$type<EvidenceRef[]>().notNull(),
		created_at: text().notNull()
	},
	(t) => [index('event_updates_event_id_reported_at_idx').on(t.event_id, t.reported_at)]
);

export const eventRelations = sqliteTable(
	'event_relations',
	{
		id: text().primaryKey(),
		from_event_id: text()
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		to_event_id: text()
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		relation_type: text({ enum: RELATION_TYPES }).notNull(),
		explanation_th: text().notNull(),
		evidence_refs: text({ mode: 'json' }).$type<EvidenceRef[]>().notNull(),
		status: text({ enum: RELATION_STATUSES }).notNull(),
		confidence: real().notNull(),
		created_at: text().notNull(),
		reviewed_at: text(),
		reviewed_by: text()
	},
	(t) => [
		uniqueIndex('event_relations_edge_unique').on(t.from_event_id, t.to_event_id, t.relation_type),
		index('event_relations_to_event_id_idx').on(t.to_event_id),
		index('event_relations_status_created_at_idx').on(t.status, t.created_at),
		check('event_relations_type_check', inList(t.relation_type, RELATION_TYPES)),
		check('event_relations_status_check', inList(t.status, RELATION_STATUSES)),
		check('event_relations_no_self_edge', sql`${t.from_event_id} <> ${t.to_event_id}`)
	]
);

// ---------------------------------------------------------------------------
// Academy (derived index of content/academy/**; content files are the source of truth)
// ---------------------------------------------------------------------------

export const academyLessons = sqliteTable('academy_lessons', {
	id: text().primaryKey(),
	week: integer().$type<1 | 2 | 3 | 4>().notNull(),
	day: integer().notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	summary: text().notNull(),
	content_path: text().notNull(),
	tags: text({ mode: 'json' }).$type<Tag[]>().notNull(),
	categories: text({ mode: 'json' }).$type<CategorySlug[]>().notNull(),
	search_text: text().notNull()
});

export const eventLessonLinks = sqliteTable(
	'event_lesson_links',
	{
		event_id: text()
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		// Cascade: a lesson removed from the catalog takes its links with it.
		lesson_id: text()
			.notNull()
			.references(() => academyLessons.id, { onDelete: 'cascade' }),
		rationale_th: text().notNull(),
		evidence_refs: text({ mode: 'json' }).$type<EvidenceRef[]>().notNull(),
		created_at: text().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.event_id, t.lesson_id] }),
		index('event_lesson_links_lesson_id_idx').on(t.lesson_id)
	]
);

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export const dailyBriefs = sqliteTable(
	'daily_briefs',
	{
		id: text().primaryKey(),
		brief_date: text().notNull(),
		edition: text({ enum: BRIEF_EDITIONS }).notNull(),
		status: text({ enum: BRIEF_STATUSES }).notNull(),
		generated_at: text().notNull(),
		published_at: text(),
		event_count: integer().notNull()
	},
	(t) => [
		uniqueIndex('daily_briefs_date_edition_unique').on(t.brief_date, t.edition),
		index('daily_briefs_status_published_at_idx').on(t.status, t.published_at),
		check('daily_briefs_edition_check', inList(t.edition, BRIEF_EDITIONS)),
		check('daily_briefs_status_check', inList(t.status, BRIEF_STATUSES))
	]
);

export const dailyBriefEvents = sqliteTable(
	'daily_brief_events',
	{
		brief_id: text()
			.notNull()
			.references(() => dailyBriefs.id, { onDelete: 'cascade' }),
		event_id: text()
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		rank: integer().notNull(),
		selection_reason: text().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.brief_id, t.event_id] }),
		uniqueIndex('daily_brief_events_brief_rank_unique').on(t.brief_id, t.rank),
		index('daily_brief_events_event_id_idx').on(t.event_id),
		check('daily_brief_events_rank_check', sql`${t.rank} >= 1`)
	]
);

// ---------------------------------------------------------------------------
// Operations: job_runs, llm_calls, content_revisions
// ---------------------------------------------------------------------------

export const jobRuns = sqliteTable(
	'job_runs',
	{
		id: text().primaryKey(),
		job_type: text({ enum: JOB_TYPES }).notNull(),
		idempotency_key: text().notNull(),
		scheduled_for: text().notNull(),
		trigger: text({ enum: JOB_TRIGGERS }).notNull(),
		attempts: integer().notNull(),
		started_at: text().notNull(),
		finished_at: text(),
		status: text({ enum: JOB_STATUSES }).notNull(),
		counters: text({ mode: 'json' }).$type<JobCounters>().notNull(),
		error: text()
	},
	(t) => [
		uniqueIndex('job_runs_idempotency_key_unique').on(t.idempotency_key),
		index('job_runs_type_finished_at_idx').on(t.job_type, t.finished_at),
		index('job_runs_started_at_idx').on(t.started_at),
		check('job_runs_status_check', inList(t.status, JOB_STATUSES)),
		check('job_runs_type_check', inList(t.job_type, JOB_TYPES))
	]
);

export const llmCalls = sqliteTable(
	'llm_calls',
	{
		id: text().primaryKey(),
		created_at: text().notNull(),
		task: text({ enum: LLM_TASKS }).notNull(),
		model: text().notNull(),
		prompt_version: text().notNull(),
		cache_key: text().notNull(),
		status: text({ enum: ['ok', 'error'] }).notNull(),
		error_kind: text({ enum: LLM_ERROR_KINDS }),
		tokens_in: integer().notNull(),
		tokens_out: integer().notNull(),
		latency_ms: integer().notNull(),
		output_json: text(),
		job_run_id: text().references(() => jobRuns.id, { onDelete: 'set null' })
	},
	(t) => [
		index('llm_calls_cache_key_status_idx').on(t.cache_key, t.status),
		index('llm_calls_created_at_idx').on(t.created_at)
	]
);

export const contentRevisions = sqliteTable(
	'content_revisions',
	{
		id: text().primaryKey(),
		entity_type: text({ enum: REVISION_ENTITY_TYPES }).notNull(),
		entity_id: text().notNull(),
		changed_at: text().notNull(),
		changed_by: text().notNull(),
		change_reason: text().notNull(),
		public_note_th: text(),
		before_after: text({ mode: 'json' }).$type<ContentRevision['before_after']>().notNull()
	},
	(t) => [
		index('content_revisions_entity_idx').on(t.entity_type, t.entity_id, t.changed_at),
		check('content_revisions_entity_type_check', inList(t.entity_type, REVISION_ENTITY_TYPES))
	]
);

/** Admin operations that are not content edits (manual job reruns). Append-only. */
export const adminActions = sqliteTable(
	'admin_actions',
	{
		id: text().primaryKey(),
		created_at: text().notNull(),
		action: text({ enum: ADMIN_ACTION_TYPES }).notNull(),
		actor: text().notNull(),
		target: text().notNull(),
		reason: text().notNull()
	},
	(t) => [
		index('admin_actions_action_created_at_idx').on(t.action, t.created_at),
		check('admin_actions_action_check', inList(t.action, ADMIN_ACTION_TYPES))
	]
);

/** `column IN ('a', 'b')` for CHECK constraints. Values are compile-time enum constants, never input. */
function inList(column: SQLiteColumn, values: readonly string[]): SQL {
	return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
}
