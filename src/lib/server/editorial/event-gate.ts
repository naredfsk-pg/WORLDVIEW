/**
 * Event publishing gates G1–G6 (ARCHITECTURE §11). Pure: no DB, network or LLM calls.
 * Citations come only from the stored `articles`; LLM output refs ("a1") must map through
 * `ref_to_article_id` to one of those articles, otherwise the output is rejected.
 * In `auto` mode an event that passes every gate is published only when the auto-publish policy
 * (`EDITORIAL_AUTO_PUBLISH`) allows it. A published event never reaches this gate in
 * `multi_source` / `off` mode: the digest flags `new_evidence_pending` without calling the LLM.
 * Auto-publish wave: in `all` mode G6 (sensitive + one registry source) no longer holds an event
 * back; it is published with at least the `unverified` credibility label (`assessCredibility`).
 * G1–G5 failures still go to review: they are real failures, not approvals.
 */
import {
	REVIEW_REASONS,
	type CategorySlug,
	type EventStatus,
	type NewsEvent,
	type ReviewReason
} from '../../types/domain';
import type { AutoPublishPolicy, EventGateDecision, EventGateInput } from '../../types/editorial';
import type { LlmErrorKind, SummaryOutput } from '../../types/llm';
import type { ArticleWithSource } from '../../types/news';
import { isHttpUrl } from '../../utils/url';
import { containsContact, containsUrl, isThaiText } from './text';

export function evaluateEventForPublish(input: EventGateInput): EventGateDecision {
	if (input.mode === 'admin') return toDecision(adminGateReasons(input), input.current_status);
	return applyAutoRules(autoGateReasons(input), input);
}

/**
 * The auto gate on an event's STORED text (the backlog job `reevaluate_pending`): G1–G3 on the
 * stored fields, G6 from the stored signals, then the same sticky reasons and policy as the
 * digest. G4/G5 were checked against the LLM output when that text was saved.
 */
export function evaluateStoredEventForAutoPublish(input: {
	event: NewsEvent;
	articles: readonly ArticleWithSource[];
	auto_publish: AutoPublishPolicy;
}): EventGateDecision {
	const { event, articles, auto_publish } = input;
	const reasons = new Set(storedEventGateReasons(event, articles));
	addSensitiveSingleSource(reasons, event.signals?.sensitive ?? false, articles, auto_publish);
	return applyAutoRules(reasons, {
		articles: [...articles],
		current_status: event.status,
		current_review_reasons: event.review_reasons,
		auto_publish
	});
}

/**
 * Hard gates G1–G3 on an event's stored text (admin publish and the stored re-evaluation). The
 * credibility reason is public text too, so it is checked here; the digest drops a failing
 * reason before saving instead.
 */
export function storedEventGateReasons(
	event: NewsEvent,
	articles: readonly ArticleWithSource[]
): ReviewReason[] {
	const reasons = adminGateReasons({
		mode: 'admin',
		articles: [...articles],
		ref_to_article_id: {},
		extraction: null,
		summary: storedSummary(event),
		signals: event.signals,
		category: event.category,
		current_status: event.status
	});
	addTextReasons(reasons, [event.credibility_reason_th]);
	return REVIEW_REASONS.filter((reason) => reasons.has(reason));
}

/**
 * `llm_failed` is retried by the next digest, so only transient failures map to it. Output that
 * failed validation, and requests that can never succeed as built, need a human.
 */
export function reviewReasonForLlmError(kind: LlmErrorKind | null | undefined): ReviewReason {
	if (kind === 'invalid_output') return 'invalid_llm_output';
	if (kind === 'invalid_request' || kind === 'input_too_large') return 'llm_request_rejected';
	return 'llm_failed';
}

/**
 * Distinct registry sources (`source_id`) among the articles: what G6 and `multi_source` count
 * (the same rule as `events.source_count`). Not the publisher string, which a feed controls
 * through its items, and each source may only cite its own `link_hosts` (ARCHITECTURE §9).
 */
export function countDistinctSources(articles: readonly ArticleWithSource[]): number {
	return new Set(articles.map((article) => article.source_id)).size;
}

/**
 * Maps LLM refs to stored article ids (deduplicated, in order). Null when any ref is unknown,
 * so callers never store a partially resolved evidence list.
 */
export function mapRefsToArticleIds(
	refs: readonly string[],
	refToArticleId: Readonly<Record<string, string>>
): string[] | null {
	const ids: string[] = [];
	for (const ref of refs) {
		// `hasOwn` so a ref such as "constructor" never resolves through the prototype.
		const id = Object.hasOwn(refToArticleId, ref) ? refToArticleId[ref] : undefined;
		if (id === undefined) return null;
		if (!ids.includes(id)) ids.push(id);
	}
	return ids;
}

/** Sticky admin reasons, then the auto-publish policy, then the outcome for the current status. */
function applyAutoRules(
	reasons: Set<ReviewReason>,
	input: Pick<
		EventGateInput,
		'articles' | 'current_status' | 'current_review_reasons' | 'auto_publish'
	>
): EventGateDecision {
	// ARCHITECTURE §6: only an admin clears a manual flag or a possible duplicate, or republishes
	// a hidden event.
	for (const sticky of ['manual_flag', 'possible_duplicate'] as const) {
		if (input.current_review_reasons?.includes(sticky)) reasons.add(sticky);
	}
	if (reasons.size === 0 && !autoPublishAllowed(input)) reasons.add('auto_publish_disabled');
	if (input.current_status === 'hidden') {
		return { status: 'keep_hidden', review_reasons: inEnumOrder(reasons) };
	}
	return toDecision(reasons, input.current_status);
}

function toDecision(reasons: Set<ReviewReason>, currentStatus: EventStatus): EventGateDecision {
	const review_reasons = inEnumOrder(reasons);
	if (review_reasons.length === 0) return { status: 'published', review_reasons: [] };
	if (currentStatus === 'published') return { status: 'keep_published', review_reasons };
	return { status: 'pending_review', review_reasons };
}

/** Stable order, so stored reasons and the "exactly [llm_failed]" retry check are deterministic. */
function inEnumOrder(reasons: Set<ReviewReason>): ReviewReason[] {
	return REVIEW_REASONS.filter((reason) => reasons.has(reason));
}

/** Admin publish: hard gates G1–G3 only; the admin's judgement replaces the rest. */
function adminGateReasons(input: EventGateInput): Set<ReviewReason> {
	const reasons = new Set<ReviewReason>();
	if (!hasCitableSource(input.articles)) reasons.add('no_source');
	if (!hasRequiredThaiFields(input.summary, input.category)) reasons.add('missing_thai_fields');
	if (input.summary) addTextReasons(reasons, generatedTexts(input.summary));
	return reasons;
}

function autoGateReasons(input: EventGateInput): Set<ReviewReason> {
	const reasons = new Set<ReviewReason>();
	// G1
	if (!hasCitableSource(input.articles)) reasons.add('no_source');

	// G4. Without LLM output the content gates have nothing to check; reporting only the LLM
	// reason keeps an `llm_failed` event eligible for the automatic retry.
	const { extraction, summary } = input;
	if (!extraction || !summary) {
		reasons.add(reviewReasonForLlmError(input.llm_error_kind));
		return reasons;
	}

	// G2, G3
	if (!hasRequiredThaiFields(summary, input.category)) reasons.add('missing_thai_fields');
	// `update_th` is only used for a published event (its timeline), so only then is it checked.
	addTextReasons(reasons, generatedTexts(summary, input.current_status === 'published'));

	// G5: every evidence list is non-empty and resolves to stored articles.
	const evidenceLists = [
		...extraction.facts.map((fact) => fact.evidence),
		...extraction.claims.map((claim) => claim.evidence),
		...summary.claims_th.map((claim) => claim.evidence),
		summary.cited_refs
	];
	const storedIds = new Set(input.articles.map((article) => article.id));
	for (const refs of evidenceLists) {
		if (refs.length === 0) reasons.add('unsupported_claim');
		const ids = mapRefsToArticleIds(refs, input.ref_to_article_id);
		if (ids === null || ids.some((id) => !storedIds.has(id))) reasons.add('invalid_llm_output');
	}

	// G6 (PRD §4.3 #6). Either source marking it sensitive is enough: stored signals may be stale.
	const sensitive = (input.signals?.sensitive ?? false) || extraction.sensitive;
	addSensitiveSingleSource(reasons, sensitive, input.articles, input.auto_publish ?? 'off');
	return reasons;
}

/**
 * G6 holds a sensitive single-source event for review in `off` / `multi_source`. In `all` it is
 * published with the credibility floor instead (owner decision 2026-11-13).
 */
function addSensitiveSingleSource(
	reasons: Set<ReviewReason>,
	sensitive: boolean,
	articles: readonly ArticleWithSource[],
	policy: AutoPublishPolicy
): void {
	if (policy !== 'all' && sensitive && countDistinctSources(articles) < 2) {
		reasons.add('sensitive_single_source');
	}
}

function hasCitableSource(articles: readonly ArticleWithSource[]): boolean {
	return articles.some((article) => isHttpUrl(article.canonical_url));
}

function hasRequiredThaiFields(
	summary: SummaryOutput | null,
	category: CategorySlug | null
): boolean {
	if (!summary || category === null) return false;
	return [
		summary.title_th,
		summary.summary_th,
		summary.what_happened_th,
		summary.why_it_matters_th
	].every(isThaiText);
}

/**
 * `auto_publish` omitted counts as `off`, so a caller that forgets the policy never publishes.
 * `multi_source` needs at least two registry sources (`countDistinctSources`).
 */
function autoPublishAllowed(input: Pick<EventGateInput, 'articles' | 'auto_publish'>): boolean {
	const policy = input.auto_publish ?? 'off';
	if (policy === 'all') return true;
	return policy === 'multi_source' && countDistinctSources(input.articles) >= 2;
}

/** G3 on every generated or edited text field: no URL and no contact details. */
function addTextReasons(reasons: Set<ReviewReason>, texts: (string | null)[]): void {
	if (texts.some(containsUrl)) reasons.add('url_in_generated_text');
	if (texts.some(containsContact)) reasons.add('contact_in_generated_text');
}

/**
 * The texts G3 checks. The credibility reason is not among them in auto mode: a failing reason
 * is dropped by `assessCredibility` and never blocks publishing.
 */
function generatedTexts(summary: SummaryOutput, includeUpdate = false): (string | null)[] {
	return [
		summary.title_th,
		summary.summary_th,
		summary.what_happened_th,
		summary.why_it_matters_th,
		summary.background_th,
		summary.uncertain_th,
		includeUpdate ? summary.update_th : null,
		...summary.claims_th.flatMap((claim) => [claim.claimant_th, claim.claim_th])
	];
}

/** The stored text in the summary shape the text gates read (no refs: G5 does not apply). */
function storedSummary(event: NewsEvent): SummaryOutput {
	return {
		title_th: event.title_th,
		summary_th: event.summary_th,
		what_happened_th: event.what_happened_th,
		why_it_matters_th: event.why_it_matters_th,
		background_th: event.background_th,
		uncertain_th: event.uncertain_th,
		claims_th: event.claims.map((claim) => ({
			claimant_th: claim.claimant_th,
			claim_th: claim.claim_th,
			evidence: []
		})),
		impact_breadth: 0,
		thailand_relevance: 0,
		cited_refs: [],
		update_th: null,
		update_refs: [],
		credibility_level: event.credibility_level,
		credibility_reason_th: event.credibility_reason_th
	};
}
