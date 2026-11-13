/**
 * Editorial publishing gates. Implemented as pure functions in `#lib/server/editorial`
 * (no DB, no network, no LLM calls). See ARCHITECTURE §11.
 */
import type { ArticleWithSource } from './news';
import type {
	CategorySlug,
	EditorialSignals,
	EventStatus,
	RelationStatus,
	RelationType,
	ReviewReason
} from './domain';
import type { SummaryOutput, ExtractionOutput, LlmErrorKind } from './llm';

/** `auto` = digest job; `admin` = human publish (soft gates are the admin's judgement). */
export type GateMode = 'auto' | 'admin';

export interface EventGateInput {
	mode: GateMode;
	/** Linked stored articles — the ONLY source of citable URLs. */
	articles: ArticleWithSource[];
	/** Map from the per-call ref ("a1") to article_id, built when the LLM input was assembled. */
	ref_to_article_id: Record<string, string>;
	extraction: ExtractionOutput | null;
	summary: SummaryOutput | null;
	signals: EditorialSignals | null;
	/** Derived from articles' taxonomy; null → missing_thai_fields gate fails. */
	category: CategorySlug | null;
	/** Current status, so a published event is never auto-demoted by a failed re-summary. */
	current_status: EventStatus;
	// CONTRACT-CHANGE: added (optional) so G4 can tell `llm_failed` (retried by the next digest)
	// from `invalid_llm_output` (needs a human). Pass the `error.kind` of the failed extraction or
	// summary call; omitted or null with a missing output → `llm_failed`.
	llm_error_kind?: LlmErrorKind | null;
	// CONTRACT-CHANGE: added (optional). The event's stored review_reasons, so the auto gate
	// keeps an admin `manual_flag` (ARCHITECTURE §6: only an admin clears it). Omitted → [].
	current_review_reasons?: ReviewReason[];
}

export type EventGateDecision =
	| { status: 'published'; review_reasons: [] }
	| { status: 'pending_review'; review_reasons: ReviewReason[] }
	/** Re-summary of an already-published event failed: keep the previous published text unchanged. */
	| { status: 'keep_published'; review_reasons: ReviewReason[] }
	// CONTRACT-CHANGE: added. Auto mode never changes a `hidden` event (only an admin republishes
	// it): the caller writes nothing. `review_reasons` are informational.
	| { status: 'keep_hidden'; review_reasons: ReviewReason[] };

export interface RelationGateInput {
	relation_type: RelationType;
	explanation_th: string;
	/** Article ids after ref mapping. */
	evidence_article_ids: string[];
	/** Article ids linked to the from-event and to-event. */
	from_article_ids: string[];
	to_article_ids: string[];
	// CONTRACT-CHANGE: added. ARCHITECTURE §11 publishes non-causal relations only when
	// confidence ≥ 0.6, so the gate needs the LLM's 0..1 confidence.
	confidence: number;
}

/** `drop` = not stored at all (no or unresolvable evidence). */
export type RelationGateDecision =
	| { action: 'store'; status: Exclude<RelationStatus, 'rejected'> }
	| { action: 'drop'; reason: string };
