/**
 * Repository interfaces. Implemented ONLY in `#lib/server/db` (Drizzle + better-sqlite3).
 * Routes use the read side; jobs receive the write side by injection (scripts/ is the composition root).
 * All methods are async so callers do not depend on the SQLite driver being synchronous.
 * Every multi-row write in one method runs in a single transaction.
 */
import type {
	AcademyLessonRow,
	ArticleTaxonomy,
	BriefDate,
	BriefEdition,
	CategorySlug,
	ContentRevision,
	DailyBriefEvent,
	EditorialSignals,
	EventLessonLink,
	EventRelation,
	EventStatus,
	EventUpdate,
	IsoUtc,
	NewsEvent,
	RelationStatus,
	ReviewReason,
	Source,
	YearMonth
} from './domain';
import type {
	ArticleWithSource,
	EventMatchCandidate,
	InsertArticleResult,
	NormalizedArticle,
	SourceDefinition
} from './news';
import type { ClaimJobInput, ClaimJobResult, JobOutcome, JobRun, JobType } from './jobs';
import type { LlmCall, LlmUsage } from './llm';
import type {
	AdminEventRow,
	AdminRelationRow,
	BriefView,
	EventDetail,
	EventSummary,
	LessonSummary,
	RelationView,
	SearchQuery,
	SourceHealthView,
	SourceRef
} from './views';

// ---------------------------------------------------------------------------
// Read side (routes). Returns published content only.
// ---------------------------------------------------------------------------

export interface PublicReadRepository {
	/** Raw timestamps; staleness is computed by `computeFreshness` in `#lib/utils/freshness`. */
	getFreshnessTimestamps(): Promise<{
		last_ingest_succeeded_at: IsoUtc | null;
		last_brief_published_at: IsoUtc | null;
	}>;
	hasPublishedDemoContent(): Promise<boolean>;
	/** Cheap `SELECT 1` for /health. Throws on DB failure. */
	ping(): Promise<void>;

	getLatestPublishedBriefDate(): Promise<BriefDate | null>;
	/** `edition` omitted → best available: daily_snapshot > evening > morning. */
	getPublishedBrief(date: BriefDate, edition?: BriefEdition): Promise<BriefView | null>;
	listPublishedEditions(date: BriefDate): Promise<BriefEdition[]>;
	getAdjacentBriefDates(
		date: BriefDate
	): Promise<{ prev: BriefDate | null; next: BriefDate | null }>;
	listBriefDatesInMonth(month: YearMonth): Promise<BriefDate[]>;

	getPublishedEventDetail(id: string): Promise<EventDetail | null>;
	listPublishedEventsForLesson(lessonId: string, limit: number): Promise<EventSummary[]>;
	listPublishedRelations(options: {
		since: IsoUtc;
		category: CategorySlug | null;
		limit: number;
	}): Promise<RelationView[]>;

	/** FTS5 (trigram tokenizer) over events; LIKE fallback for queries shorter than 3 characters. */
	searchEvents(query: SearchQuery): Promise<{ items: EventSummary[]; total: number }>;
	searchLessons(query: SearchQuery): Promise<{ items: LessonSummary[]; total: number }>;
}

// ---------------------------------------------------------------------------
// Write side (jobs)
// ---------------------------------------------------------------------------

export interface IngestRepository {
	/** Upsert by id; sources missing from the registry are set enabled=false (never deleted). */
	syncSources(definitions: SourceDefinition[]): Promise<void>;
	listEnabledSources(): Promise<Source[]>;
	/** Dedup by canonical_url (UNIQUE) then content_hash. Never updates an existing row. */
	insertArticleIfNew(article: NormalizedArticle): Promise<InsertArticleResult>;
	recordSourceFetch(
		sourceId: string,
		result: { ok: true; at: IsoUtc } | { ok: false; at: IsoUtc; error: string }
	): Promise<void>;
}

export interface EventWithArticles {
	event: NewsEvent;
	articles: ArticleWithSource[];
}

/** Result of summarization + publish gates, persisted atomically by `saveEventContent`. */
export interface EventContentWrite {
	title_th: string;
	summary_th: string;
	what_happened_th: string;
	why_it_matters_th: string;
	background_th: string | null;
	uncertain_th: string | null;
	claims: NewsEvent['claims'];
	category: CategorySlug;
	regions: NewsEvent['regions'];
	countries: NewsEvent['countries'];
	tags: NewsEvent['tags'];
	signals: EditorialSignals;
	occurred_at: IsoUtc | null;
	summarized_at: IsoUtc;
	/** From `evaluateEventForPublish` ('keep_published' → caller does not save). */
	status: 'published' | 'pending_review';
	review_reasons: ReviewReason[];
	new_updates: Omit<EventUpdate, 'id' | 'event_id' | 'created_at'>[];
}

export interface DigestRepository {
	listUnassignedArticles(since: IsoUtc, limit: number): Promise<ArticleWithSource[]>;
	saveArticleTaxonomy(articleId: string, taxonomy: ArticleTaxonomy): Promise<void>;
	listMatchableEvents(since: IsoUtc): Promise<EventMatchCandidate[]>;
	/** Creates a `draft` event (Thai fields '') and links the articles; recomputes derived fields. */
	createDraftEvent(articleIds: string[], confidence: number, now: IsoUtc): Promise<string>;
	/** Links and recomputes first_seen_at, event_date, last_updated_at, source_count, is_demo. */
	linkArticles(
		eventId: string,
		articleIds: string[],
		confidence: number,
		now: IsoUtc
	): Promise<void>;
	/**
	 * Events whose content must be (re)generated:
	 * status 'draft'; or 'pending_review' with review_reasons exactly ['llm_failed'];
	 * or 'published' with an article linked after summarized_at.
	 */
	listEventsNeedingContent(limit: number): Promise<EventWithArticles[]>;
	saveEventContent(eventId: string, content: EventContentWrite, now: IsoUtc): Promise<void>;
	/** LLM/gate failure on a non-published event: status → pending_review with these reasons; text unchanged. */
	markEventForReview(eventId: string, reasons: ReviewReason[], now: IsoUtc): Promise<void>;
	/** Published events of the last `since` window, excluding `eventId`, for relation suggestions. */
	listRelationCandidates(
		eventId: string,
		since: IsoUtc,
		limit: number
	): Promise<EventWithArticles[]>;
	/** Upsert on (from, to, type). Never downgrades an admin-reviewed relation. */
	upsertRelation(
		relation: Omit<EventRelation, 'id' | 'created_at' | 'reviewed_at' | 'reviewed_by'>
	): Promise<void>;
	replaceLessonLinks(eventId: string, links: Omit<EventLessonLink, 'created_at'>[]): Promise<void>;
	listLessonCatalog(): Promise<AcademyLessonRow[]>;
}

export interface BriefCandidate extends EventSummary {
	signals: EditorialSignals | null;
	/** Has an update or a published relation to an older event (continuity, PRD §4.4). */
	is_continuing: boolean;
}

export interface BriefRepository {
	/** Published events with ≥1 linked article whose (published_at ?? ingested_at) is in [start, end). */
	listCandidateEvents(window: { start_utc: IsoUtc; end_utc: IsoUtc }): Promise<BriefCandidate[]>;
	/** Upsert brief by (brief_date, edition) and replace its items, in one transaction. */
	saveBrief(input: {
		brief_date: BriefDate;
		edition: BriefEdition;
		status: 'draft' | 'published';
		generated_at: IsoUtc;
		items: Omit<DailyBriefEvent, 'brief_id'>[];
	}): Promise<string>;
}

export interface JobRunRepository {
	/** Atomic claim of UNIQUE(idempotency_key). A `running` row older than 30 min is treated as dead and reclaimed. */
	claim(input: ClaimJobInput): Promise<ClaimJobResult>;
	// CONTRACT-CHANGE: `finish` now takes the claim token `attempt` (= `JobRun.attempts` returned by
	// `claim`) and resolves `false` when that claim was lost to a stale-reclaim, so a slow process
	// can no longer overwrite the newer attempt's outcome. Was: `finish(runId, outcome, finishedAt): Promise<void>`.
	finish(runId: string, attempt: number, outcome: JobOutcome, finishedAt: IsoUtc): Promise<boolean>;
	listRecent(limit: number): Promise<JobRun[]>;
	lastSucceeded(jobType: JobType): Promise<JobRun | null>;
}

export interface LlmCallRepository {
	/** Latest `ok` output_json for the key, or null. */
	findCachedOutput(cacheKey: string): Promise<string | null>;
	record(call: Omit<LlmCall, 'id'>): Promise<void>;
	/** Non-cached calls (ok + error) since `since`; tokens = tokens_in + tokens_out. */
	usageSince(since: IsoUtc): Promise<LlmUsage>;
}

export interface AcademyCatalogRepository {
	/** Replace all academy_lessons rows and rebuild lessons FTS, in one transaction. */
	replaceLessonCatalog(rows: AcademyLessonRow[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Admin side (routes under /admin; every write appends a content_revisions row)
// ---------------------------------------------------------------------------

export interface RevisionMeta {
	changed_by: string;
	change_reason: string;
	public_note_th: string | null;
}

export type AdminEventPatch = Partial<
	Pick<
		NewsEvent,
		| 'title_th'
		| 'summary_th'
		| 'what_happened_th'
		| 'why_it_matters_th'
		| 'background_th'
		| 'uncertain_th'
		| 'claims'
		| 'category'
		| 'regions'
		| 'countries'
		| 'tags'
		| 'occurred_at'
	>
>;

export interface AdminRepository {
	listReviewQueue(): Promise<{ events: AdminEventRow[]; relations: AdminRelationRow[] }>;
	countReviewQueue(): Promise<{ events: number; relations: number }>;
	getEventForEdit(
		id: string
	): Promise<{ event: NewsEvent; sources: SourceRef[]; revisions: ContentRevision[] } | null>;
	updateEvent(id: string, patch: AdminEventPatch, meta: RevisionMeta, now: IsoUtc): Promise<void>;
	/** Caller must have run the admin publish gate first when status = 'published'. */
	setEventStatus(id: string, status: EventStatus, meta: RevisionMeta, now: IsoUtc): Promise<void>;
	setRelationStatus(
		id: string,
		status: RelationStatus,
		meta: RevisionMeta,
		now: IsoUtc
	): Promise<void>;
	listSourceHealth(): Promise<SourceHealthView[]>;
}

/** What `#lib/server/db` exports via `getRepositories()` (routes) and `createRepositories(db)` (scripts/tests). */
export interface Repositories {
	read: PublicReadRepository;
	ingest: IngestRepository;
	digest: DigestRepository;
	briefs: BriefRepository;
	jobs: JobRunRepository;
	llmCalls: LlmCallRepository;
	academy: AcademyCatalogRepository;
	admin: AdminRepository;
}
