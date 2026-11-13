/**
 * Digest content step (ARCHITECTURE §9 digest order 4): extraction → summary → publish gates →
 * save. Every outcome, including every LLM failure, is decided by `evaluateEventForPublish`:
 * - `published` / `pending_review` with LLM output → `saveEventContent` (text + taxonomy + status)
 * - `pending_review` without output → `markEventForReview` (text unchanged)
 * - `keep_published` after a transient LLM failure (`[llm_failed]`) → nothing is written, so the
 *   next digest retries; any other `keep_published` → `markContentChecked`, so the event comes
 *   back only when newer evidence is linked
 * - `keep_hidden` → nothing is written
 * Auto-publish policy (`EDITORIAL_AUTO_PUBLISH`, ARCHITECTURE §11): the gate turns a would-be
 * publication into `pending_review [auto_publish_disabled]` unless the policy allows it, and in
 * `multi_source` / `off` a published event is never re-summarized: `flagNewEvidence` keeps its
 * text, adds `new_evidence_pending` for an admin, and no LLM call is made.
 * Every write checks that the row is still as listed; otherwise nothing is written (`skipped`),
 * so an admin flag or hide during the LLM call always wins. When the LLM budget (daily or per
 * run) is used up, nothing is written either (`deferred`): the event stays as it is for the next
 * run instead of being marked failed.
 * A published event re-summarized and published again also gets a timeline entry
 * (`event_updates`) from the summary's `update_th`, with the newly linked articles as evidence.
 * `summarized_at` (and the checked marker) is the time the events were listed, so an article
 * linked while the LLM was working still triggers the next re-summary.
 */
import type {
	CategorySlug,
	CountryCode,
	EditorialSignals,
	IsoUtc,
	NewsEvent,
	RegionSlug,
	ReviewReason,
	Tag
} from '#lib/types/domain.js';
import type { AutoPublishPolicy } from '#lib/types/editorial.js';
import type { Logger } from '#lib/types/jobs.js';
import type {
	ArticleRefInput,
	ExtractionOutput,
	LlmErrorKind,
	SummaryOutput
} from '#lib/types/llm.js';
import type { ArticleWithSource } from '#lib/types/news.js';
import type {
	DigestRepository,
	EventContentWrite,
	EventWithArticles
} from '#lib/types/repositories.js';
import {
	buildEventUpdate,
	evaluateEventForPublish,
	filterAllegationTags,
	mapRefsToArticleIds
} from '../editorial/index.js';
import { toArticleRef, type RunTask } from './digest-llm.js';

/** ARCHITECTURE §10: at most 12 articles per extraction / summary call (the newest are kept). */
export const MAX_LLM_ARTICLES = 12;
/** ARCHITECTURE §9: event tags are the union of the article tags (allegation tags dropped), capped. */
export const MAX_EVENT_TAGS = 10;

export interface ContentDeps {
	digest: Pick<
		DigestRepository,
		'saveEventContent' | 'markEventForReview' | 'markContentChecked' | 'flagNewEvidence'
	>;
	runTask: RunTask;
	now: () => Date;
	logger: Logger;
	/** When the events were listed: the evidence up to here is what the LLM saw. */
	checkedAt: IsoUtc;
	/**
	 * Why tagging this event's articles failed, when it did: an event with no tagged article cannot
	 * be categorized. Null → the gate records `llm_failed` (retried by the next digest).
	 */
	taggingErrorKind: LlmErrorKind | null;
	autoPublish: AutoPublishPolicy;
}

/**
 * `published` carries the row as stored (admin-kept fields included) for the links step.
 * `skipped`: the row changed since it was listed, nothing written. `deferred`: the LLM budget is
 * used up, nothing written (the caller stops the content step).
 */
export type ContentResult =
	| { outcome: 'published'; event: NewsEvent }
	| { outcome: 'pending_review' | 'unchanged'; review_reasons: ReviewReason[] }
	| { outcome: 'new_evidence_pending' }
	| { outcome: 'skipped'; reason: 'changed_since_listed' | 'review_reason_present' }
	| { outcome: 'deferred' };

export interface EventTaxonomy {
	category: CategorySlug | null;
	regions: RegionSlug[];
	countries: CountryCode[];
	tags: Tag[];
}

export async function generateEventContent(
	item: EventWithArticles,
	deps: ContentDeps
): Promise<ContentResult> {
	const { event, articles } = item;
	if (event.status === 'published' && deps.autoPublish !== 'all') {
		const flagged = await deps.digest.flagNewEvidence(
			event.id,
			deps.checkedAt,
			event.updated_at,
			deps.now().toISOString()
		);
		deps.logger.info(flagged ? 'new evidence flagged for an admin' : 'event changed; skipped', {
			event_id: event.id
		});
		return flagged
			? { outcome: 'new_evidence_pending' }
			: { outcome: 'skipped', reason: 'changed_since_listed' };
	}

	const taxonomy = deriveEventTaxonomy(articles);
	const refToArticleId: Record<string, string> = {};
	const inputArticles = articles.slice(-MAX_LLM_ARTICLES).map((article, index) => {
		const ref = `a${index + 1}`;
		refToArticleId[ref] = article.id;
		return toArticleRef(article, ref);
	});
	// The articles linked since the last summary that the LLM sees: what a timeline entry is about.
	const newRefs = Object.keys(refToArticleId).filter((ref) =>
		item.new_article_ids.includes(refToArticleId[ref]!)
	);

	// Without any tagged article there is no category to publish under: skip the LLM and let the
	// gate record the tagging failure (an `llm_failed` event is retried by the next digest).
	const generated =
		taxonomy.category === null
			? { extraction: null, summary: null, errorKind: deps.taggingErrorKind }
			: await extractAndSummarize(inputArticles, newRefs, item, deps.runTask);
	if (generated.errorKind === 'budget_exceeded') {
		deps.logger.info('event deferred: LLM budget used up', { event_id: event.id });
		return { outcome: 'deferred' };
	}
	const { extraction, summary } = generated;
	const signals: EditorialSignals | null =
		extraction && summary
			? {
					impact_breadth: summary.impact_breadth,
					thailand_relevance: summary.thailand_relevance,
					sensitive: extraction.sensitive
				}
			: event.signals;

	const decision = evaluateEventForPublish({
		mode: 'auto',
		articles,
		ref_to_article_id: refToArticleId,
		extraction,
		summary,
		signals,
		category: taxonomy.category,
		current_status: event.status,
		llm_error_kind: generated.errorKind,
		current_review_reasons: event.review_reasons,
		auto_publish: deps.autoPublish
	});
	const logFields = {
		event_id: event.id,
		decision: decision.status,
		reasons: decision.review_reasons
	};

	if (decision.status === 'keep_published' || decision.status === 'keep_hidden') {
		const isTransient =
			decision.review_reasons.length === 1 && decision.review_reasons[0] === 'llm_failed';
		if (decision.status === 'keep_published' && !isTransient) {
			await deps.digest.markContentChecked(event.id, deps.checkedAt, deps.now().toISOString());
		}
		deps.logger.info('event content kept', logFields);
		return { outcome: 'unchanged', review_reasons: decision.review_reasons };
	}

	const now = deps.now().toISOString();
	if (!extraction || !summary || !signals || taxonomy.category === null) {
		const marked = await deps.digest.markEventForReview(
			event.id,
			decision.review_reasons,
			{ updated_at: event.updated_at, status: event.status },
			now
		);
		if (!marked) {
			deps.logger.info('event changed since listed; skipped', logFields);
			return { outcome: 'skipped', reason: 'changed_since_listed' };
		}
		deps.logger.info('event marked for review', logFields);
		return { outcome: 'pending_review', review_reasons: decision.review_reasons };
	}

	// Only a published event that stays published gets an entry; keep_* outcomes returned above.
	// Its evidence is what the line is based on (`update_refs`), which must all be new refs.
	const updateRefs = summary.update_refs;
	const hasValidUpdateRefs =
		updateRefs.length > 0 && updateRefs.every((ref) => newRefs.includes(ref));
	const timelineUpdate =
		event.status === 'published' && decision.status === 'published' && hasValidUpdateRefs
			? buildEventUpdate({
					update_th: summary.update_th,
					evidence_article_ids: updateRefs.map((ref) => refToArticleId[ref]!),
					articles
				})
			: null;
	const content: EventContentWrite = {
		title_th: summary.title_th,
		summary_th: summary.summary_th,
		what_happened_th: summary.what_happened_th,
		why_it_matters_th: summary.why_it_matters_th,
		background_th: summary.background_th,
		uncertain_th: summary.uncertain_th,
		claims: summary.claims_th.map((claim) => ({
			claimant_th: claim.claimant_th,
			claim_th: claim.claim_th,
			// Unresolvable refs already failed the gate (invalid_llm_output); store no evidence for them.
			evidence_refs: (mapRefsToArticleIds(claim.evidence, refToArticleId) ?? []).map(
				(article_id) => ({ article_id })
			)
		})),
		category: taxonomy.category,
		regions: taxonomy.regions,
		countries: taxonomy.countries,
		tags: taxonomy.tags,
		signals,
		occurred_at: extraction.occurred_at,
		summarized_at: deps.checkedAt,
		status: decision.status,
		review_reasons: decision.review_reasons,
		new_updates: timelineUpdate ? [timelineUpdate] : [],
		listed: { updated_at: event.updated_at, status: event.status }
	};
	// Fields an admin edited are kept by the repository, and an unpublished event an admin edited
	// waits for the admin, so the written status can differ from the gate's.
	const saved = await deps.digest.saveEventContent(event.id, content, now);
	if (saved.status === 'skipped') {
		deps.logger.info('event content not saved', { ...logFields, skip_reason: saved.reason });
		return { outcome: 'skipped', reason: saved.reason };
	}
	deps.logger.info('event content saved', {
		...logFields,
		saved_status: saved.status,
		admin_fields_kept: saved.admin_fields_kept
	});
	return saved.status === 'published'
		? { outcome: 'published', event: saved.event }
		: { outcome: 'pending_review', review_reasons: decision.review_reasons };
}

/**
 * Event taxonomy from the articles' tagging (ARCHITECTURE §9): `category` is the majority (a tie
 * goes to the earliest article; `articles` are oldest first), the rest is the union. Tags that
 * label an allegation about a person are never public (owner policy), so they are dropped before
 * the cap and cannot take a topic tag's slot.
 */
export function deriveEventTaxonomy(articles: readonly ArticleWithSource[]): EventTaxonomy {
	const counts = new Map<CategorySlug, number>();
	const regions = new Set<RegionSlug>();
	const countries = new Set<CountryCode>();
	const tags = new Set<Tag>();
	for (const { taxonomy } of articles) {
		if (!taxonomy) continue;
		counts.set(taxonomy.category, (counts.get(taxonomy.category) ?? 0) + 1);
		taxonomy.regions.forEach((region) => regions.add(region));
		taxonomy.countries.forEach((country) => countries.add(country));
		taxonomy.tags.forEach((tag) => tags.add(tag));
	}

	let category: CategorySlug | null = null;
	for (const [candidate, count] of counts) {
		// Map order is first-seen order, so strictly greater keeps the earliest on a tie.
		if (category === null || count > counts.get(category)!) category = candidate;
	}
	return {
		category,
		regions: [...regions],
		countries: [...countries],
		tags: filterAllegationTags([...tags]).slice(0, MAX_EVENT_TAGS)
	};
}

async function extractAndSummarize(
	inputArticles: ArticleRefInput[],
	newRefs: string[],
	item: EventWithArticles,
	runTask: RunTask
): Promise<{
	extraction: ExtractionOutput | null;
	summary: SummaryOutput | null;
	errorKind: LlmErrorKind | null;
}> {
	const extracted = await runTask('extraction', { articles: inputArticles });
	if (!extracted.ok) return { extraction: null, summary: null, errorKind: extracted.error.kind };

	// Re-summarizing a published event: pass the current wording so it stays stable.
	const previous =
		item.event.status === 'published'
			? { title_th: item.event.title_th, summary_th: item.event.summary_th, new_refs: newRefs }
			: null;
	const summarized = await runTask('summary', {
		articles: inputArticles,
		extraction: extracted.data,
		previous
	});
	if (!summarized.ok) {
		return { extraction: extracted.data, summary: null, errorKind: summarized.error.kind };
	}
	return { extraction: extracted.data, summary: summarized.data, errorKind: null };
}
