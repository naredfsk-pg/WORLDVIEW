/**
 * Repository interfaces. Implemented ONLY in `#lib/server/db` (Drizzle + better-sqlite3).
 * Routes use the read side; jobs receive the write side by injection (scripts/ is the composition root).
 * All methods are async so callers do not depend on the SQLite driver being synchronous.
 * Every multi-row write in one method runs in a single transaction.
 */
import type {
	AcademyLessonRow,
	AdminAction,
	AdminActionType,
	ArticleTaxonomy,
	BriefDate,
	BriefEdition,
	CategorySlug,
	ContentRevision,
	DailyBrief,
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
	Tag,
	YearMonth
} from './domain';
import type {
	ArticleWithSource,
	EventMatchCandidate,
	FeedValidators,
	InsertArticleResult,
	NormalizedArticle,
	SourceDefinition
} from './news';
import type { ClaimJobInput, ClaimJobResult, JobOutcome, JobRun, JobType } from './jobs';
import type { LlmCall, LlmUsage } from './llm';
import type {
	AdminEventRow,
	AdminSourceRef,
	AdminRelationRow,
	BriefView,
	EventDetail,
	EventSummary,
	LessonSummary,
	RelationView,
	SearchQuery,
	SourceHealthView
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
	// CONTRACT-CHANGE: the ok variant takes optional `validators` (Wave 2 conditional GET);
	// when given they replace the stored etag / last_modified.
	recordSourceFetch(
		sourceId: string,
		result:
			| { ok: true; at: IsoUtc; validators?: FeedValidators }
			| { ok: false; at: IsoUtc; error: string }
	): Promise<void>;
}

export interface EventWithArticles {
	event: NewsEvent;
	/** Oldest evidence first. */
	articles: ArticleWithSource[];
	// CONTRACT-CHANGE (Wave 3): added for the event timeline.
	/** Ids of the articles linked after `event.summarized_at` (all of them while it is null). */
	new_article_ids: string[];
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
	/** Appended to the timeline; one whose evidence set equals a stored update's is skipped. */
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
	 * or 'published' without `manual_flag` and with an article linked after summarized_at.
	 * Newest evidence first, id as tie-break.
	 */
	listEventsNeedingContent(limit: number): Promise<EventWithArticles[]>;
	// CONTRACT-CHANGE (Wave 2): content fields an admin ever edited (a `content_revisions` row
	// for the event whose actor is not "system") are never overwritten. An unpublished event with
	// admin edits is not auto-published: it stays `pending_review` with `manual_flag`. Resolves to
	// the status written and the fields kept. Was `Promise<void>`.
	saveEventContent(
		eventId: string,
		content: EventContentWrite,
		now: IsoUtc
	): Promise<{
		status: 'published' | 'pending_review';
		admin_fields_kept: string[];
		/** The row as stored (admin-kept fields included), for the steps that follow. */
		event: NewsEvent;
	}>;
	// CONTRACT-CHANGE: added (Wave 2 review). A published event whose re-summary was rejected by
	// the gates (not a transient LLM failure) keeps its text; `summarized_at` moves to
	// `checkedAt` so it returns only when newer evidence is linked. No-op for other statuses.
	markContentChecked(eventId: string, checkedAt: IsoUtc, now: IsoUtc): Promise<void>;
	/** LLM/gate failure on a non-published event: status → pending_review with these reasons; text unchanged. */
	markEventForReview(eventId: string, reasons: ReviewReason[], now: IsoUtc): Promise<void>;
	// CONTRACT-CHANGE: added (Wave 2). The LLM `clustering` task said a draft event reports the
	// same happening as `targetEventId`: move its articles there and delete the draft, in one
	// transaction. Throws unless the source is a `draft`, the target exists and is not hidden, and
	// both have the same is_demo. Resolves false (nothing changed) when an admin edited the draft.
	// CONTRACT-CHANGE (Wave 3 review): also throws for a `published` target; published events
	// are never changed by clustering (see flagPossibleDuplicate).
	mergeDraftEvent(
		sourceEventId: string,
		targetEventId: string,
		confidence: number,
		now: IsoUtc
	): Promise<boolean>;
	// CONTRACT-CHANGE: added (Wave 3 review). The LLM `clustering` task said a draft reports the
	// same happening as a published event: in one transaction, add `possible_duplicate` to the
	// draft's review_reasons (it stays a draft until digest saves its content, then waits for an
	// admin) and upsert a `pending_review` `same_topic` relation from the draft to the published
	// event with the draft's articles as evidence. The published event is not touched. Resolves
	// false (nothing written) when the source is no longer a draft; throws unless the target is
	// published with the same is_demo.
	flagPossibleDuplicate(
		draftEventId: string,
		publishedEventId: string,
		relation: { explanation_th: string; evidence_article_ids: string[]; confidence: number },
		now: IsoUtc
	): Promise<boolean>;
	/**
	 * Published events of the last `since` window, excluding `eventId`, that share a tag or a
	 * region other than `global` with it (and its is_demo), for relation suggestions.
	 */
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
	// CONTRACT-CHANGE: added (Wave 2 review).
	/** Newest `published_at ?? ingested_at` of its articles inside the window; null if none. */
	window_evidence_at: IsoUtc | null;
	/** An item of a published morning / evening brief of `include_briefs_of`. */
	in_day_briefs: boolean;
}

export interface BriefRepository {
	/** Published events with ≥1 linked article whose (published_at ?? ingested_at) is in [start, end). */
	// CONTRACT-CHANGE: optional `include_briefs_of` (Wave 2): also the published events that are
	// items of that date's published morning / evening briefs (the daily_snapshot merge, §8).
	listCandidateEvents(window: {
		start_utc: IsoUtc;
		end_utc: IsoUtc;
		include_briefs_of?: BriefDate;
	}): Promise<BriefCandidate[]>;
	/**
	 * Upsert brief by (brief_date, edition) and replace its items, in one transaction.
	 * A `draft` (no items) never replaces a `published` brief: the call is then a no-op.
	 */
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
	// CONTRACT-CHANGE: added (Wave 2 review). Network calls recorded for one job run, so digest
	// counters never include another process's calls.
	usageForJobRun(jobRunId: string): Promise<LlmUsage>;
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
	): Promise<{ event: NewsEvent; sources: AdminSourceRef[]; revisions: ContentRevision[] } | null>;
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

	// CONTRACT-CHANGE (Wave 2 admin, additive): state-checked transitions. Each one reads the row,
	// checks the allowed source states (and the gate) and writes the change plus its
	// `content_revisions` row in ONE transaction, so there is no check-then-write race.
	/**
	 * Optimistic-concurrency edit: writes `patch` (+ revision) only when the row's `updated_at`
	 * still equals `expectedUpdatedAt`, the value the editor loaded; otherwise `conflict`.
	 */
	updateEventIfCurrent(
		id: string,
		expectedUpdatedAt: IsoUtc,
		patch: AdminEventPatch,
		meta: RevisionMeta,
		now: IsoUtc
	): Promise<AdminTransitionResult>;
	/** Published relations, newest first (the admin "unpublish" list). */
	listPublishedRelations(limit: number): Promise<AdminRelationRow[]>;
	/** Hidden events, most recently updated first (the admin "unhide" list). */
	listHiddenEvents(limit: number): Promise<AdminEventRow[]>;
	/**
	 * Admin publish or republish (draft | pending_review | hidden → published). `gate` gets the
	 * current row and its linked articles and returns blocking reasons (the admin gate G1–G3);
	 * any reason leaves the row unchanged.
	 */
	publishEvent(
		id: string,
		gate: (current: Pick<EventWithArticles, 'event' | 'articles'>) => ReviewReason[],
		meta: RevisionMeta,
		now: IsoUtc,
		// CONTRACT-CHANGE (Wave 3): the public tag filter (allegation tags, owner policy) applied to
		// pipeline tags on publish; tags an admin edited are kept as they are.
		publicTags: (tags: Tag[]) => Tag[]
	): Promise<AdminTransitionResult>;
	/** draft | pending_review | published → hidden. */
	hideEvent(id: string, meta: RevisionMeta, now: IsoUtc): Promise<AdminTransitionResult>;
	/** draft | pending_review → pending_review with `manual_flag` added (digest never auto-publishes it). */
	flagEvent(id: string, meta: RevisionMeta, now: IsoUtc): Promise<AdminTransitionResult>;
	/**
	 * pending_review → published; pending_review | published → rejected (unpublish).
	 * Also sets reviewed_at / reviewed_by.
	 */
	reviewRelation(
		id: string,
		status: 'published' | 'rejected',
		meta: RevisionMeta,
		now: IsoUtc
	): Promise<AdminTransitionResult>;
	/** Newest first (brief_date, then edition). */
	listRecentBriefs(limit: number): Promise<DailyBrief[]>;
	/** published ↔ hidden only; a draft brief has no eligible events and stays a draft. */
	setBriefVisibility(
		id: string,
		status: 'published' | 'hidden',
		meta: RevisionMeta,
		now: IsoUtc
	): Promise<AdminTransitionResult>;
	/** Appends an `admin_actions` audit row (non-content admin operations, e.g. manual reruns). */
	recordAdminAction(action: Omit<AdminAction, 'id'>): Promise<void>;
	/** Newest first. */
	listRecentAdminActions(action: AdminActionType, limit: number): Promise<AdminAction[]>;
	/**
	 * LLM usage since `since`: network calls, tokens and failures from `llm_calls`; cache hits
	 * from the `llm_cache_hits` job counters (cache hits are never written to `llm_calls`).
	 */
	llmUsageSince(since: IsoUtc): Promise<AdminLlmUsage>;
}

// CONTRACT-CHANGE (Wave 2 admin): added with the methods above.
export type AdminTransitionResult =
	| { ok: true }
	| { ok: false; error: 'not_found' | 'invalid_state' }
	/** The row changed (`updated_at` moved) since the editor loaded it. */
	| { ok: false; error: 'conflict' }
	| { ok: false; error: 'gate_failed'; reasons: ReviewReason[] };

export interface AdminLlmUsage {
	requests: number;
	tokens: number;
	failures: number;
	cache_hits: number;
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
