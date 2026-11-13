/**
 * UI read models and `+page.server.ts` / `+layout.server.ts` return types.
 * Only published content reaches these types; drafts / pending_review / hidden never do (except admin types).
 * Every URL here comes from stored articles (`Article.canonical_url`), never from LLM output.
 */
import type {
	BriefDate,
	BriefEdition,
	CategorySlug,
	ContentRevision,
	CountryCode,
	CredibilityLevel,
	FurtherReading,
	GlossaryEntry,
	IsoUtc,
	NewsEvent,
	RegionSlug,
	RelationStatus,
	RelationType,
	Tag,
	YearMonth
} from './domain';
import type { JobRun } from './jobs';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface SourceRef {
	article_id: string;
	/** = Article.publisher_name. */
	source_name: string;
	title: string;
	/** Null when the feed gave no timestamp; UI shows "ไม่ระบุเวลาเผยแพร่". */
	published_at: IsoUtc | null;
	url: string;
}

/**
 * Admin-only: `SourceRef` plus the stored excerpt. Excerpts are internal (LLM input and admin
 * review, PRD §4.2), so public DTOs use `SourceRef`, which has no excerpt field.
 */
export interface AdminSourceRef extends SourceRef {
	excerpt: string | null;
}

/** Card-level payload for lists (Today, brief, archive, search, related). */
export interface EventSummary {
	id: string;
	title_th: string;
	summary_th: string;
	category: CategorySlug;
	regions: RegionSlug[];
	countries: CountryCode[];
	tags: Tag[];
	event_date: BriefDate;
	occurred_at: IsoUtc | null;
	last_updated_at: IsoUtc;
	/** 1 → show single-source label. */
	source_count: number;
	is_demo: boolean;
	// CONTRACT-CHANGE (auto-publish wave): every list and detail shows the credibility badge.
	/** `none` → no badge; otherwise CREDIBILITY_LABEL_TH[level]. */
	credibility_level: CredibilityLevel;
	/** Optional one-sentence Thai reason shown with the badge; null when there is none. */
	credibility_reason_th: string | null;
}

export interface ClaimView {
	claimant_th: string;
	claim_th: string;
	evidence_source_urls: string[];
}

export interface EventUpdateView {
	id: string;
	occurred_at: IsoUtc | null;
	reported_at: IsoUtc;
	update_text_th: string;
	evidence_source_urls: string[];
}

/** Published relations only. `potential_impact` must be labeled as possible, not confirmed. */
export interface RelationView {
	id: string;
	from_event_id: string;
	to_event_id: string;
	relation_type: RelationType;
	explanation_th: string;
	/** Non-empty. */
	evidence_source_urls: string[];
	/** True when an admin reviewed it (always true for causal types). */
	reviewed: boolean;
	from_event: EventSummary;
	to_event: EventSummary;
}

export interface CorrectionView {
	changed_at: IsoUtc;
	note_th: string;
}

export interface EventDetail extends EventSummary {
	what_happened_th: string;
	why_it_matters_th: string;
	background_th: string | null;
	uncertain_th: string | null;
	claims: ClaimView[];
	/** Non-empty for every published event. Ordered by published_at asc, nulls last. */
	sources: SourceRef[];
	/** Timeline, ordered by reported_at asc. */
	updates: EventUpdateView[];
	relations: RelationView[];
	lessons: LessonSummary[];
	brief_appearances: { brief_date: BriefDate; edition: BriefEdition }[];
	corrections: CorrectionView[];
	published_at: IsoUtc;
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export interface BriefEventItem extends EventSummary {
	rank: number;
	selection_reason: string;
}

export interface BriefView {
	id: string;
	brief_date: BriefDate;
	edition: BriefEdition;
	generated_at: IsoUtc;
	published_at: IsoUtc;
	/** Ordered by rank. */
	events: BriefEventItem[];
}

// ---------------------------------------------------------------------------
// Academy
// ---------------------------------------------------------------------------

export interface LessonSummary {
	id: string;
	week: 1 | 2 | 3 | 4;
	day: number;
	slug: string;
	title: string;
	summary: string;
	related_categories: CategorySlug[];
}

export interface TocItem {
	/** Anchor id on the rendered heading. */
	id: string;
	text: string;
	level: 2 | 3;
}

export interface LessonDetail extends LessonSummary {
	learning_objectives: string[];
	glossary: GlossaryEntry[];
	key_questions: string[];
	further_reading: FurtherReading[];
	related_tags: Tag[];
	last_reviewed_at: string;
	/** Sanitized HTML rendered server-side by `#lib/content`. The only `{@html}` allowed in the app. */
	html: string;
	toc: TocItem[];
}

export interface AcademyWeekMeta {
	week: 1 | 2 | 3 | 4;
	title_th: string;
	tagline_th: string;
	description_th: string;
	first_day: number;
	last_day: number;
}

export interface AcademyWeek extends AcademyWeekMeta {
	lessons: LessonSummary[];
}

// ---------------------------------------------------------------------------
// Freshness / global state
// ---------------------------------------------------------------------------

export interface Freshness {
	last_ingest_succeeded_at: IsoUtc | null;
	last_brief_published_at: IsoUtc | null;
	/** True when no successful ingest in the last 9 h (covers the 23:00→06:00 gap). */
	stale: boolean;
}

// ---------------------------------------------------------------------------
// Page data (return types of load functions)
// ---------------------------------------------------------------------------

/** `src/routes/+layout.server.ts` */
export interface LayoutData {
	freshness: Freshness;
	/** Any published event is demo content → show `DemoNotice` globally. */
	demo_mode: boolean;
	today: BriefDate;
	site_url: string;
}

/** `/` */
export interface TodayPageData {
	/** Latest published brief: today's if any, else the most recent one. */
	brief: BriefView | null;
	brief_is_today: boolean;
	/** For "continue reading" (progress is in localStorage). */
	lessons: LessonSummary[];
}

/** `/brief/[date]` (optional `?edition=`) */
export interface BriefPageData {
	date: BriefDate;
	brief: BriefView;
	editions_available: BriefEdition[];
	prev_date: BriefDate | null;
	next_date: BriefDate | null;
}

/** `/events/[id]` */
export interface EventPageData {
	event: EventDetail;
}

/** `/academy` */
export interface AcademyPageData {
	weeks: AcademyWeek[];
}

/** `/academy/week/[week]/day/[day]` */
export interface LessonPageData {
	lesson: LessonDetail;
	week: AcademyWeekMeta;
	prev: LessonSummary | null;
	next: LessonSummary | null;
	related_events: EventSummary[];
}

/** `/archive?month=YYYY-MM&date=YYYY-MM-DD&category=&region=` */
export interface ArchivePageData {
	month: YearMonth;
	/** The current Bangkok month: the last month the calendar navigates to. */
	max_month: YearMonth;
	/** Dates in `month` with a published brief (calendar dots). */
	available_dates: BriefDate[];
	selected_date: BriefDate | null;
	/** Best edition of selected_date: daily_snapshot > evening > morning. Unfiltered; filter in the component. */
	brief: BriefView | null;
	category: CategorySlug | null;
	region: RegionSlug | null;
}

/** `/connections?category=` — MVP relation list (graph is Phase 2). */
export interface ConnectionsPageData {
	relations: RelationView[];
	category: CategorySlug | null;
}

export const SEARCH_SCOPES = ['all', 'events', 'lessons'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export interface SearchQuery {
	q: string;
	scope: SearchScope;
	category: CategorySlug | null;
	region: RegionSlug | null;
	from: BriefDate | null;
	to: BriefDate | null;
	limit: number;
	offset: number;
}

/**
 * Search totals stop counting past this, so a total above it only means "more than the cap" (the
 * page shows "1000+"). Equals the deepest result the route serves (50 pages × 20).
 */
export const SEARCH_TOTAL_CAP = 1000;

export interface SearchResults {
	events: EventSummary[];
	/** At most SEARCH_TOTAL_CAP + 1; same for `lessons_total`. */
	events_total: number;
	lessons: LessonSummary[];
	lessons_total: number;
}

/** `/search?q=&scope=&category=&region=&from=&to=&page=` */
export interface SearchPageData {
	/** Null when `q` is empty (show the search form only). */
	query: SearchQuery | null;
	results: SearchResults | null;
}

/** `GET /health` → 200 for ok|degraded (stale data), 503 for error (DB unreachable). `cache-control: no-store`. */
export interface HealthResponse {
	status: 'ok' | 'degraded' | 'error';
	db: 'ok' | 'error';
	stale: boolean;
	last_ingest_succeeded_at: IsoUtc | null;
	last_brief_published_at: IsoUtc | null;
	time: IsoUtc;
	/** App version from `$app/env`. */
	version: string;
}

// ---------------------------------------------------------------------------
// Admin (behind Cloudflare Access + app-side JWT check)
// ---------------------------------------------------------------------------

export interface AdminIdentity {
	email: string;
}

export interface SourceHealthView {
	id: string;
	name: string;
	enabled: boolean;
	is_demo: boolean;
	last_success_at: IsoUtc | null;
	last_error_at: IsoUtc | null;
	last_error: string | null;
}

export interface LlmUsageView {
	requests_today: number;
	tokens_today: number;
	// CONTRACT-CHANGE (Wave 2 admin, additive): FR-06 also asks for failures and cache hits.
	failures_today: number;
	cache_hits_today: number;
	max_requests: number;
	max_tokens: number;
}

/** `/admin` */
export interface AdminDashboardData {
	admin: AdminIdentity;
	job_runs: JobRun[];
	sources: SourceHealthView[];
	review_counts: { events: number; relations: number };
	llm_usage: LlmUsageView;
	freshness: Freshness;
}

export interface AdminEventRow {
	id: string;
	status: NewsEvent['status'];
	review_reasons: NewsEvent['review_reasons'];
	title_th: string;
	/** First article title, for drafts without Thai text. */
	fallback_title: string;
	category: CategorySlug | null;
	source_count: number;
	last_updated_at: IsoUtc;
	// CONTRACT-CHANGE (auto-publish wave): shown in the admin queue and lists.
	credibility_level: CredibilityLevel;
}

/** Relation as shown in the review queue (may be pending). */
// CONTRACT-CHANGE (Wave 2 admin review fix): admin rows use `AdminRelationEndpoint` instead of
// `EventSummary`, so relations whose events are still uncategorized (or not public) are listed.
export interface AdminRelationEndpoint {
	id: string;
	/** '' for drafts without Thai text. */
	title_th: string;
	status: NewsEvent['status'];
	category: CategorySlug | null;
}

/** Relation as shown in the admin queue (pending or published). */
export interface AdminRelationRow extends Omit<
	RelationView,
	'reviewed' | 'from_event' | 'to_event'
> {
	status: RelationStatus;
	confidence: number;
	from_event: AdminRelationEndpoint;
	to_event: AdminRelationEndpoint;
}

/** `/admin/review` */
export interface AdminReviewData {
	admin: AdminIdentity;
	events: AdminEventRow[];
	relations: AdminRelationRow[];
}

/** `/admin/events/[id]` */
export interface AdminEventEditData {
	admin: AdminIdentity;
	event: NewsEvent;
	sources: AdminSourceRef[];
	revisions: ContentRevision[];
}
