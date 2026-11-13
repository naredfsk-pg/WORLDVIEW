/**
 * WORLDVIEW domain entities: one interface per persisted table (PRD §7).
 * Pure types and `as const` enums only. No imports, no runtime dependencies.
 *
 * Conventions (see docs/ARCHITECTURE.md §5):
 * - Data records (DB rows, DTOs, LLM payloads) use snake_case field names.
 * - All ids are TEXT. Generated ids use `crypto.randomUUID()`; sources and lessons have stable slugs.
 * - JSON columns are typed below; SQLite stores them as TEXT (Drizzle `text({ mode: 'json' })`).
 * - Thai user-facing text fields end in `_th`.
 */

// ---------------------------------------------------------------------------
// Time primitives
// ---------------------------------------------------------------------------

/** UTC instant, always produced by `Date#toISOString()`: "2026-11-13T00:15:00.000Z". Lexically sortable. */
export type IsoUtc = string;

/** Calendar date in Asia/Bangkok, "YYYY-MM-DD". Never derived with the host timezone. */
export type BriefDate = string;

/** Calendar month in Asia/Bangkok, "YYYY-MM". */
export type YearMonth = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Taxonomy (closed sets; LLM output outside these sets is invalid)
// ---------------------------------------------------------------------------

export const CATEGORY_SLUGS = [
	'geopolitics',
	'economy',
	'technology',
	'energy',
	'society'
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const CATEGORY_LABEL_TH = {
	geopolitics: 'ภูมิรัฐศาสตร์',
	economy: 'เศรษฐกิจ',
	technology: 'เทคโนโลยี',
	energy: 'พลังงาน',
	society: 'สังคม'
} as const satisfies Record<CategorySlug, string>;

/** `asia` = East/South/Central Asia; `southeast-asia` is separate because of the Thai audience. */
export const REGION_SLUGS = [
	'global',
	'asia',
	'southeast-asia',
	'middle-east',
	'europe',
	'africa',
	'americas',
	'oceania'
] as const;
export type RegionSlug = (typeof REGION_SLUGS)[number];

export const REGION_LABEL_TH = {
	global: 'ทั่วโลก',
	asia: 'เอเชีย',
	'southeast-asia': 'เอเชียตะวันออกเฉียงใต้',
	'middle-east': 'ตะวันออกกลาง',
	europe: 'ยุโรป',
	africa: 'แอฟริกา',
	americas: 'อเมริกา',
	oceania: 'โอเชียเนีย'
} as const satisfies Record<RegionSlug, string>;

/** ISO 3166-1 alpha-2, upper case, e.g. "TH". */
export type CountryCode = string;

/** kebab-case English, e.g. "cold-war". Shared vocabulary with Academy `related_tags`. */
export type Tag = string;

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

export const SOURCE_KINDS = ['rss', 'fixture'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Source {
	/** Stable slug from the registry, e.g. "un-news". */
	id: string;
	name: string;
	kind: SourceKind;
	homepage_url: string;
	/** https URL for `rss`; repo-relative file path for `fixture`. */
	feed_url: string;
	license_notes: string;
	/** False → adapters must store `excerpt = null`. */
	allow_excerpt: boolean;
	/** True for fictional fixture/demo sources. Propagates to events (`NewsEvent.is_demo`). */
	is_demo: boolean;
	enabled: boolean;
	last_success_at: IsoUtc | null;
	last_error_at: IsoUtc | null;
	/** Short, sanitized message. Never contains secrets or response bodies. */
	last_error: string | null;
	// CONTRACT-CHANGE: added (Wave 2). HTTP validators from the last successful fetch, sent back
	// as If-None-Match / If-Modified-Since so an unchanged feed answers 304 with no body.
	etag: string | null;
	last_modified: string | null;
}

// ---------------------------------------------------------------------------
// articles
// ---------------------------------------------------------------------------

/** UNIQUE(canonical_url). INDEX(content_hash), INDEX(published_at). */
export interface Article {
	id: string;
	/** The discovery source (registry entry) that delivered this item. */
	source_id: string;
	/** Link exactly as given by the feed (validated http/https). */
	source_url: string;
	/** Normalized URL used for dedup and for display. See ARCHITECTURE §9. */
	canonical_url: string;
	/** Cited reporting outlet. Equals `Source.name` unless the source is a discovery service. */
	publisher_name: string;
	title: string;
	/** Only when `Source.allow_excerpt`; never full text. */
	excerpt: string | null;
	/** BCP-47 tag from the feed, e.g. "en", "th"; null if absent. */
	language: string | null;
	/** Null when the feed gives no parseable, zoned timestamp. Never guessed. */
	published_at: IsoUtc | null;
	ingested_at: IsoUtc;
	/** sha256 hex of normalized title + excerpt. See ARCHITECTURE §9. */
	content_hash: string;
	/** Allowed feed metadata only (guid, categories, author). Never article bodies. */
	raw_metadata: JsonObject;
	/** Set by the LLM `tagging` task during digest; null until tagged (or if tagging failed). */
	taxonomy: ArticleTaxonomy | null;
}

export interface ArticleTaxonomy {
	category: CategorySlug;
	regions: RegionSlug[];
	countries: CountryCode[];
	tags: Tag[];
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export const EVENT_STATUSES = ['draft', 'pending_review', 'published', 'hidden'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const REVIEW_REASONS = [
	/** No linked stored article with a valid http(s) URL. Hard gate: blocks admin publish too. */
	'no_source',
	/** LLM unavailable, timed out, budget exceeded, or not configured. Digest retries automatically. */
	'llm_failed',
	/** LLM output failed Zod validation or referenced unknown article refs. */
	'invalid_llm_output',
	// CONTRACT-CHANGE: added. The LLM request cannot succeed as built (input too large or empty,
	// HTTP 400/401/403). Not auto-retried: it needs a human or a config fix.
	'llm_request_rejected',
	/** A fact or claim has no evidence ref. */
	'unsupported_claim',
	/** Generated text contains a URL (URLs must come from stored articles only). */
	'url_in_generated_text',
	/** Marked sensitive/contested and fewer than 2 distinct publishers. */
	'sensitive_single_source',
	/** A required Thai field is empty or contains no Thai script, or category is null. */
	'missing_thai_fields',
	// CONTRACT-CHANGE (Wave 3): the clustering LLM said this draft reports the same happening as
	// a published event. Never auto-published (carried forward like manual_flag); a pending
	// same_topic relation points at the published event. An admin publishes or hides it.
	'possible_duplicate',
	/** Flagged by an admin. */
	'manual_flag'
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Points at a stored article. Resolved to URLs at read time; never an LLM-produced URL. */
export interface EvidenceRef {
	article_id: string;
}

/** A statement attributed to a named party (FR-02 content policy). Not a confirmed fact. */
export interface AttributedClaim {
	claimant_th: string;
	claim_th: string;
	/** Non-empty for published events. */
	evidence_refs: EvidenceRef[];
}

/** Inputs to brief ranking (PRD §4.4). Produced by the summary task, clamped by editorial. */
export interface EditorialSignals {
	impact_breadth: 0 | 1 | 2 | 3;
	thailand_relevance: 0 | 1 | 2 | 3;
	/** Contested conflict / sensitive topic (PRD §4.3 rule 6). */
	sensitive: boolean;
}

/**
 * Named `NewsEvent` (not `Event`) to avoid shadowing the DOM `Event` global.
 * Thai text fields are '' while `status = 'draft'`; publish gates require them non-empty.
 * INDEX(status, event_date), INDEX(category), INDEX(last_updated_at).
 */
export interface NewsEvent {
	id: string;
	status: EventStatus;
	/** Empty unless `status = 'pending_review'` (or an admin flag remains on a hidden event). */
	review_reasons: ReviewReason[];
	title_th: string;
	summary_th: string;
	/** Confirmed facts only. */
	what_happened_th: string;
	/** Analysis; UI labels it as AI-assisted. */
	why_it_matters_th: string;
	background_th: string | null;
	uncertain_th: string | null;
	claims: AttributedClaim[];
	/** Majority of linked articles' taxonomy.category. Null only while unpublishable (no tagged article). */
	category: CategorySlug | null;
	/** Union over linked articles' taxonomy. */
	regions: RegionSlug[];
	countries: CountryCode[];
	tags: Tag[];
	signals: EditorialSignals | null;
	/** When it actually happened, if a source states it. Null otherwise; never guessed. */
	occurred_at: IsoUtc | null;
	/** min(article.published_at ?? article.ingested_at) over linked articles. */
	first_seen_at: IsoUtc;
	/** toBriefDate(first_seen_at). Stored for indexing; recomputed when first_seen_at changes. */
	event_date: BriefDate;
	/** Newest evidence time: max over linked articles (published_at ?? ingested_at) and updates (reported_at). */
	last_updated_at: IsoUtc;
	/** First transition to `published`. */
	published_at: IsoUtc | null;
	/** Last successful summary. Content is stale when an article was linked after this. */
	summarized_at: IsoUtc | null;
	/** Distinct `publisher_name` count over linked articles. 1 → UI shows single-source label. */
	source_count: number;
	/** True if any linked article comes from an `is_demo` source. */
	is_demo: boolean;
	created_at: IsoUtc;
	/** Row modification time (editing), distinct from `last_updated_at`. */
	updated_at: IsoUtc;
}

/** PK(event_id, article_id) and UNIQUE(article_id): an article belongs to at most one event. */
export interface EventArticle {
	event_id: string;
	article_id: string;
	/** 0..1 grouping confidence (rules or LLM clustering). */
	relation_confidence: number;
	linked_at: IsoUtc;
}

/** INDEX(event_id, reported_at). */
export interface EventUpdate {
	id: string;
	event_id: string;
	occurred_at: IsoUtc | null;
	/** Newest `published_at ?? ingested_at` among the evidence articles of this update. */
	reported_at: IsoUtc;
	update_text_th: string;
	/** Non-empty. */
	evidence_refs: EvidenceRef[];
	created_at: IsoUtc;
}

// ---------------------------------------------------------------------------
// event_relations
// ---------------------------------------------------------------------------

/**
 * Read as "from <type> to": A follow_up B = A follows up on B; A response_to B; A background_of B;
 * A potential_impact B = A may affect B; same_topic is symmetric and stored with from_event_id < to_event_id.
 * `causes` is intentionally absent from the MVP (PRD FR-04, §14).
 */
export const RELATION_TYPES = [
	'same_topic',
	'follow_up',
	'response_to',
	'background_of',
	'potential_impact'
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** Relation types that assert one event led to / may affect another. Always need human review. */
export const CAUSAL_RELATION_TYPES = [
	'response_to',
	'potential_impact'
] as const satisfies readonly RelationType[];
export type CausalRelationType = (typeof CAUSAL_RELATION_TYPES)[number];

export const RELATION_STATUSES = ['pending_review', 'published', 'rejected'] as const;
export type RelationStatus = (typeof RELATION_STATUSES)[number];

/** UNIQUE(from_event_id, to_event_id, relation_type). INDEX(to_event_id). */
export interface EventRelation {
	id: string;
	from_event_id: string;
	to_event_id: string;
	relation_type: RelationType;
	explanation_th: string;
	/** Non-empty; every ref is an article linked to the from- or to-event. */
	evidence_refs: EvidenceRef[];
	status: RelationStatus;
	confidence: number;
	created_at: IsoUtc;
	/** Set when an admin publishes/rejects. UI `reviewed` = reviewed_at !== null. */
	reviewed_at: IsoUtc | null;
	/** Admin email. */
	reviewed_by: string | null;
}

// ---------------------------------------------------------------------------
// Academy (content files are the source of truth; academy_lessons is a derived index)
// ---------------------------------------------------------------------------

export interface GlossaryEntry {
	term: string;
	term_th: string;
	definition: string;
}

export interface FurtherReading {
	title: string;
	publisher: string;
	/** Null when unverified; never an invented URL. */
	url: string | null;
	/** e.g. "TODO: verify". */
	note?: string;
}

/** Exact YAML frontmatter of `content/academy/week-{W}/day-{DD}-{slug}.md`. */
export interface LessonFrontmatter {
	/** "w{W}-d{DD}", e.g. "w1-d01". Stable. */
	id: string;
	week: 1 | 2 | 3 | 4;
	/** Global day 1..30. Week 1 = 1–7, 2 = 8–14, 3 = 15–21, 4 = 22–30. */
	day: number;
	slug: string;
	title: string;
	summary: string;
	learning_objectives: string[];
	glossary: GlossaryEntry[];
	key_questions: string[];
	further_reading: FurtherReading[];
	related_tags: Tag[];
	related_categories: CategorySlug[];
	/** BriefDate-format string "YYYY-MM-DD". */
	last_reviewed_at: string;
}

export interface Lesson extends LessonFrontmatter {
	/** Markdown body (Thai, `##` headings form the TOC). */
	content_markdown: string;
	/** Repo-relative path, e.g. "content/academy/week-1/day-01-world-wars-overview.md". */
	content_path: string;
}

/** Row of `academy_lessons` (PRD §7), replaced wholesale by `npm run academy:sync`. */
export interface AcademyLessonRow {
	id: string;
	week: 1 | 2 | 3 | 4;
	day: number;
	slug: string;
	title: string;
	summary: string;
	content_path: string;
	/** = related_tags. */
	tags: Tag[];
	/** = related_categories. */
	categories: CategorySlug[];
	/** Plain-text body for FTS; not rendered. */
	search_text: string;
}

/** PK(event_id, lesson_id). lesson_id must exist in academy_lessons. */
export interface EventLessonLink {
	event_id: string;
	lesson_id: string;
	rationale_th: string;
	/** May be empty: the link is explanatory, not a factual claim. */
	evidence_refs: EvidenceRef[];
	created_at: IsoUtc;
}

// ---------------------------------------------------------------------------
// daily_briefs
// ---------------------------------------------------------------------------

export const BRIEF_EDITIONS = ['morning', 'evening', 'daily_snapshot'] as const;
export type BriefEdition = (typeof BRIEF_EDITIONS)[number];

/** `draft` = generated with zero eligible events (not shown); `hidden` = unpublished by admin. */
export const BRIEF_STATUSES = ['draft', 'published', 'hidden'] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

/** UNIQUE(brief_date, edition). */
export interface DailyBrief {
	id: string;
	brief_date: BriefDate;
	edition: BriefEdition;
	status: BriefStatus;
	generated_at: IsoUtc;
	published_at: IsoUtc | null;
	event_count: number;
}

/** PK(brief_id, event_id). UNIQUE(brief_id, rank). */
export interface DailyBriefEvent {
	brief_id: string;
	event_id: string;
	/** 1-based. */
	rank: number;
	/** Thai, shown to admins and optionally in UI ("ทำไมเลือกข่าวนี้"). */
	selection_reason: string;
}

// ---------------------------------------------------------------------------
// content_revisions
// ---------------------------------------------------------------------------

export const REVISION_ENTITY_TYPES = [
	'event',
	'event_relation',
	'event_lesson_link',
	'daily_brief'
] as const;
export type RevisionEntityType = (typeof REVISION_ENTITY_TYPES)[number];

/** Written for every admin change to published-or-reviewable content. Append-only. */
export interface ContentRevision {
	id: string;
	entity_type: RevisionEntityType;
	entity_id: string;
	changed_at: IsoUtc;
	/** Admin email, or "system" for automated changes to already-published content. */
	changed_by: string;
	/** Internal reason; required. */
	change_reason: string;
	/** Public correction note (PRD §9.2 "corrections"); null for non-public edits. */
	public_note_th: string | null;
	before_after: { before: JsonObject | null; after: JsonObject | null };
}

// CONTRACT-CHANGE (Wave 2 admin review fix): audit rows for admin operations that are not
// content edits (no `content_revisions` entity), e.g. a manual job rerun. Append-only.
// CONTRACT-CHANGE (Wave 2 digest lane): one `rerun_{job_type}` per job type the admin page runs.
export const ADMIN_ACTION_TYPES = [
	'rerun_ingest',
	'rerun_digest',
	'rerun_brief_morning',
	'rerun_brief_evening',
	'rerun_archive_snapshot'
] as const;
export type AdminActionType = (typeof ADMIN_ACTION_TYPES)[number];

export interface AdminAction {
	id: string;
	created_at: IsoUtc;
	action: AdminActionType;
	/** Admin email (`locals.admin.email`). */
	actor: string;
	/** What it acted on, e.g. the job slot `ingest:2026-11-13T12#3` (idempotency key # attempt). */
	target: string;
	/** Required `change_reason` from the form. */
	reason: string;
}
