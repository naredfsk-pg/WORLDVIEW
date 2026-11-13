/**
 * Event publishing gates G1–G6 (ARCHITECTURE §11). Pure: no DB, network or LLM calls.
 * Citations come only from the stored `articles`; LLM output refs ("a1") must map through
 * `ref_to_article_id` to one of those articles, otherwise the output is rejected.
 */
import { REVIEW_REASONS, type CategorySlug, type ReviewReason } from '../../types/domain';
import type { EventGateDecision, EventGateInput } from '../../types/editorial';
import type { LlmErrorKind, SummaryOutput } from '../../types/llm';
import type { ArticleWithSource } from '../../types/news';
import { containsUrl, isHttpUrl, isThaiText } from './text';

export function evaluateEventForPublish(input: EventGateInput): EventGateDecision {
	const reasons = input.mode === 'admin' ? adminGateReasons(input) : autoGateReasons(input);
	// ARCHITECTURE §6: only an admin clears a manual flag or republishes a hidden event.
	if (input.mode === 'auto' && input.current_review_reasons?.includes('manual_flag')) {
		reasons.add('manual_flag');
	}

	// Stable order (the enum order) so stored reasons and the "exactly [llm_failed]" retry check are deterministic.
	const review_reasons = REVIEW_REASONS.filter((reason) => reasons.has(reason));
	if (input.mode === 'auto' && input.current_status === 'hidden') {
		return { status: 'keep_hidden', review_reasons };
	}
	if (review_reasons.length === 0) return { status: 'published', review_reasons: [] };
	if (input.current_status === 'published') return { status: 'keep_published', review_reasons };
	return { status: 'pending_review', review_reasons };
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

/** Distinct `publisher_name` count: the `source_count` behind the single-source label and G6. */
export function countDistinctPublishers(articles: readonly ArticleWithSource[]): number {
	return new Set(articles.map((article) => article.publisher_name.trim().toLowerCase())).size;
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

/** Admin publish: hard gates G1–G3 only; the admin's judgement replaces the rest. */
function adminGateReasons(input: EventGateInput): Set<ReviewReason> {
	const reasons = new Set<ReviewReason>();
	if (!hasCitableSource(input.articles)) reasons.add('no_source');
	if (!hasRequiredThaiFields(input.summary, input.category)) reasons.add('missing_thai_fields');
	if (input.summary && hasUrlInText(input.summary)) reasons.add('url_in_generated_text');
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
	if (hasUrlInText(summary)) reasons.add('url_in_generated_text');

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
	if (sensitive && countDistinctPublishers(input.articles) < 2) {
		reasons.add('sensitive_single_source');
	}
	return reasons;
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

function hasUrlInText(summary: SummaryOutput): boolean {
	const fields = [
		summary.title_th,
		summary.summary_th,
		summary.what_happened_th,
		summary.why_it_matters_th,
		summary.background_th,
		summary.uncertain_th,
		...summary.claims_th.flatMap((claim) => [claim.claimant_th, claim.claim_th])
	];
	return fields.some(containsUrl);
}
