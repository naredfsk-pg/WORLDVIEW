/**
 * LLM contracts. Implemented in `#lib/server/llm` (provider, routing, cache, caps, Zod schemas, prompts).
 * Consumers (jobs, editorial) depend on `LLMProvider` only.
 *
 * Reference ids: every input item carries a short `ref` ("a1", "e1", ...) assigned per call.
 * The provider maps refs back to real ids server-side. LLM output never contains URLs or real ids,
 * except `lesson_id`, which is validated against the lessons supplied in the input.
 */
import type {
	BriefDate,
	CategorySlug,
	CountryCode,
	IsoUtc,
	RegionSlug,
	RelationType,
	Tag
} from './domain';

export const LLM_TASKS = [
	'tagging',
	'clustering',
	'extraction',
	'summary',
	'relations',
	'academy_linking'
] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

// ---------------------------------------------------------------------------
// Shared input fragments (all content is untrusted data)
// ---------------------------------------------------------------------------

export interface ArticleRefInput {
	ref: string;
	source_name: string;
	title: string;
	excerpt: string | null;
	published_at: IsoUtc | null;
	language: string | null;
}

export interface EventRefInput {
	ref: string;
	title_th: string;
	summary_th: string;
	event_date: BriefDate;
	category: CategorySlug;
	tags: Tag[];
	articles: ArticleRefInput[];
}

// ---------------------------------------------------------------------------
// Per-task input / output (output = Zod-validated shape)
// ---------------------------------------------------------------------------

export interface TaggingInput {
	articles: ArticleRefInput[];
}
export interface TaggingOutput {
	items: {
		ref: string;
		category: CategorySlug;
		regions: RegionSlug[];
		countries: CountryCode[];
		tags: Tag[];
	}[];
}

export interface ClusterItemInput {
	title: string;
	summary: string | null;
	published_at: IsoUtc | null;
	tags: Tag[];
}
export interface ClusteringInput {
	pairs: { pair_ref: string; a: ClusterItemInput; b: ClusterItemInput }[];
}
export interface ClusteringOutput {
	decisions: {
		pair_ref: string;
		verdict: 'same_event' | 'related' | 'unrelated';
		confidence: number;
		// CONTRACT-CHANGE (Wave 3, clustering@3): short Thai reason, shown to the admin on a
		// possible-duplicate relation. Omitted, invalid or overlong → null (never fails the call).
		rationale_th?: string | null;
	}[];
}

export interface ExtractionInput {
	articles: ArticleRefInput[];
}
export interface ExtractionOutput {
	/** Statements confirmed by the cited articles. `evidence` = article refs, non-empty. */
	facts: { text: string; evidence: string[] }[];
	claims: { claimant: string; claim: string; evidence: string[] }[];
	occurred_at: IsoUtc | null;
	countries: CountryCode[];
	sensitive: boolean;
	open_questions: string[];
}

export interface SummaryInput {
	articles: ArticleRefInput[];
	extraction: ExtractionOutput;
	/** Present when re-summarizing a published event, to keep wording stable. */
	// CONTRACT-CHANGE (Wave 3): `new_refs` = refs of the articles linked since the last summary.
	previous: { title_th: string; summary_th: string; new_refs: string[] } | null;
}
export interface SummaryOutput {
	title_th: string;
	summary_th: string;
	what_happened_th: string;
	why_it_matters_th: string;
	background_th: string | null;
	uncertain_th: string | null;
	claims_th: { claimant_th: string; claim_th: string; evidence: string[] }[];
	impact_breadth: 0 | 1 | 2 | 3;
	thailand_relevance: 0 | 1 | 2 | 3;
	/** Article refs the text relies on; must be a subset of input refs. */
	cited_refs: string[];
	// CONTRACT-CHANGE (Wave 3): added for the event timeline (`event_updates`).
	/** One Thai line on what `previous.new_refs` add; null without `previous` or nothing new. */
	update_th: string | null;
	// CONTRACT-CHANGE (Wave 3 review, summary@4): the refs (a subset of `previous.new_refs`) the
	// update line is based on; its only evidence. Empty or not a subset → no timeline row.
	update_refs: string[];
}

export interface RelationsInput {
	event: EventRefInput;
	candidates: EventRefInput[];
}
export interface RelationsOutput {
	relations: {
		candidate_ref: string;
		relation_type: RelationType;
		/** `event_to_candidate` → from = event, to = candidate. */
		direction: 'event_to_candidate' | 'candidate_to_event';
		explanation_th: string;
		/** Article refs from either event; non-empty. */
		evidence: string[];
		confidence: number;
	}[];
}

export interface AcademyLinkingInput {
	event: Omit<EventRefInput, 'articles' | 'event_date'>;
	lessons: {
		lesson_id: string;
		title: string;
		summary: string;
		related_tags: Tag[];
		related_categories: CategorySlug[];
	}[];
}
export interface AcademyLinkingOutput {
	/** At most 3. `lesson_id` must be one of the input lesson ids. */
	links: { lesson_id: string; rationale_th: string }[];
}

export interface LlmTaskMap {
	tagging: { input: TaggingInput; output: TaggingOutput };
	clustering: { input: ClusteringInput; output: ClusteringOutput };
	extraction: { input: ExtractionInput; output: ExtractionOutput };
	summary: { input: SummaryInput; output: SummaryOutput };
	relations: { input: RelationsInput; output: RelationsOutput };
	academy_linking: { input: AcademyLinkingInput; output: AcademyLinkingOutput };
}
export type LlmInput<T extends LlmTask> = LlmTaskMap[T]['input'];
export type LlmOutput<T extends LlmTask> = LlmTaskMap[T]['output'];

// ---------------------------------------------------------------------------
// Provider (task level) — what jobs/editorial call
// ---------------------------------------------------------------------------

export const LLM_ERROR_KINDS = [
	'not_configured',
	'budget_exceeded',
	'timeout',
	'rate_limited',
	'http_error',
	'invalid_output',
	/** Estimated input tokens exceed LLM_MAX_INPUT_TOKENS; builders must cap inputs first. */
	'input_too_large',
	'aborted',
	// CONTRACT-CHANGE: added. The request can never succeed as sent: the endpoint rejected it
	// (HTTP 400 / 401 / 403) or the input has no articles. Not retried; editorial routes it to a
	// human (`llm_request_rejected`) instead of the automatic `llm_failed` retry.
	'invalid_request'
] as const;
export type LlmErrorKind = (typeof LLM_ERROR_KINDS)[number];

export interface LlmError {
	kind: LlmErrorKind;
	/** Sanitized; never includes the API key, prompt or response body. */
	message: string;
	/** Last model tried, if any. */
	model: string | null;
}

export interface LlmCallMeta {
	task: LlmTask;
	model: string;
	prompt_version: string;
	cache_key: string;
	cached: boolean;
	fell_back: boolean;
	tokens_in: number;
	tokens_out: number;
	latency_ms: number;
}

/** Expected failures are values, not exceptions. Callers map `ok: false` to `pending_review`. */
export type LlmResult<T> =
	{ ok: true; data: T; meta: LlmCallMeta } | { ok: false; error: LlmError };

export interface LlmCallOptions {
	signal?: AbortSignal;
	job_run_id?: string;
}

export interface LLMProvider {
	run<T extends LlmTask>(
		task: T,
		input: LlmInput<T>,
		options?: LlmCallOptions
	): Promise<LlmResult<LlmOutput<T>>>;
}

/** Test double: `createMockLlmProvider(handlers)`. Missing handler → `{ ok: false, kind: 'not_configured' }`. */
export type MockLlmHandlers = {
	[T in LlmTask]?: (input: LlmInput<T>) => LlmOutput<T> | LlmError;
};

// ---------------------------------------------------------------------------
// Transport (internal to #lib/server/llm) — OpenAI-compatible /v1/chat/completions
// ---------------------------------------------------------------------------

export interface ChatMessage {
	/** 'assistant' is used only for the single schema-repair turn. */
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	/** Omitted entirely (not sent) for models matching LLM_OMIT_TEMPERATURE_FOR. */
	temperature?: number;
	max_tokens: number;
	// CONTRACT-CHANGE: added. JSON mode is sent by default; the provider retries once without it
	// when a model answers HTTP 400. Output parsing never depends on it.
	response_format?: { type: 'json_object' };
	signal: AbortSignal;
}

export interface ChatResponse {
	content: string;
	tokens_in: number | null;
	tokens_out: number | null;
}

/** Throws `{ kind: LlmErrorKind; retryable: boolean; status: number | null }`-shaped errors. */
export interface ChatTransport {
	complete(request: ChatRequest): Promise<ChatResponse>;
}

/** Resolved per task from config. */
export interface ModelRoute {
	primary: string;
	/** Cross-vendor: `cc/*` → LLM_MODEL_FALLBACK, `cx/*` → LLM_MODEL_FALLBACK_SECONDARY. Null if unset or equal to primary. */
	fallback: string | null;
}

// ---------------------------------------------------------------------------
// llm_calls table (added; cache + daily caps + monitoring)
// ---------------------------------------------------------------------------

/** INDEX(cache_key, status), INDEX(created_at). */
export interface LlmCall {
	id: string;
	created_at: IsoUtc;
	task: LlmTask;
	model: string;
	prompt_version: string;
	/** sha256 hex of canonical JSON { task, model, prompt_version, input }. */
	cache_key: string;
	status: 'ok' | 'error';
	error_kind: LlmErrorKind | null;
	tokens_in: number;
	tokens_out: number;
	latency_ms: number;
	/** Validated output JSON (status 'ok' only). Used as the cache value. */
	output_json: string | null;
	job_run_id: string | null;
}

export interface LlmUsage {
	requests: number;
	tokens: number;
}
