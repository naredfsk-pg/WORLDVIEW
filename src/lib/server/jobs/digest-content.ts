/**
 * Digest content step (ARCHITECTURE §9 digest order 4): extraction → summary → publish gates →
 * save. Every outcome, including every LLM failure, is decided by `evaluateEventForPublish`:
 * - `published` / `pending_review` with LLM output → `saveEventContent` (text + taxonomy + status)
 * - `pending_review` without output → `markEventForReview` (text unchanged)
 * - `keep_published` / `keep_hidden` → nothing is written
 */
import type {
	CategorySlug,
	CountryCode,
	EditorialSignals,
	RegionSlug,
	ReviewReason,
	Tag
} from '#lib/types/domain.js';
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
import { evaluateEventForPublish, mapRefsToArticleIds } from '../editorial/index.js';
import { toArticleRef, type RunTask } from './digest-llm.js';

/** ARCHITECTURE §10: at most 12 articles per extraction / summary call (the newest are kept). */
export const MAX_LLM_ARTICLES = 12;
/** ARCHITECTURE §9: event tags are the union of the article tags, capped. */
export const MAX_EVENT_TAGS = 10;

export interface ContentDeps {
	digest: Pick<DigestRepository, 'saveEventContent' | 'markEventForReview'>;
	runTask: RunTask;
	now: () => Date;
	logger: Logger;
	/** Why this run's tagging failed, if it did: an event with no tagged article cannot be categorized. */
	taggingErrorKind: LlmErrorKind | null;
}

export type ContentResult =
	| { outcome: 'published'; content: EventContentWrite }
	| { outcome: 'pending_review' | 'unchanged'; review_reasons: ReviewReason[] };

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
	const taxonomy = deriveEventTaxonomy(articles);
	const refToArticleId: Record<string, string> = {};
	const inputArticles = articles.slice(-MAX_LLM_ARTICLES).map((article, index) => {
		const ref = `a${index + 1}`;
		refToArticleId[ref] = article.id;
		return toArticleRef(article, ref);
	});

	// Without any tagged article there is no category to publish under: skip the LLM and let the
	// gate record the tagging failure (an `llm_failed` event is retried by the next digest).
	const generated =
		taxonomy.category === null
			? { extraction: null, summary: null, errorKind: deps.taggingErrorKind }
			: await extractAndSummarize(inputArticles, item, deps.runTask);
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
		current_review_reasons: event.review_reasons
	});
	const logFields = {
		event_id: event.id,
		decision: decision.status,
		reasons: decision.review_reasons
	};

	if (decision.status === 'keep_published' || decision.status === 'keep_hidden') {
		deps.logger.info('event content kept', logFields);
		return { outcome: 'unchanged', review_reasons: decision.review_reasons };
	}

	const now = deps.now().toISOString();
	if (!extraction || !summary || !signals || taxonomy.category === null) {
		await deps.digest.markEventForReview(event.id, decision.review_reasons, now);
		deps.logger.info('event marked for review', logFields);
		return { outcome: 'pending_review', review_reasons: decision.review_reasons };
	}

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
		summarized_at: now,
		status: decision.status,
		review_reasons: decision.review_reasons,
		new_updates: []
	};
	// Fields an admin edited are kept by the repository, and an unpublished event an admin edited
	// waits for the admin, so the written status can differ from the gate's.
	const saved = await deps.digest.saveEventContent(event.id, content, now);
	deps.logger.info('event content saved', {
		...logFields,
		saved_status: saved.status,
		admin_fields_kept: saved.admin_fields_kept
	});
	return saved.status === 'published'
		? { outcome: 'published', content }
		: { outcome: 'pending_review', review_reasons: decision.review_reasons };
}

/**
 * Event taxonomy from the articles' tagging (ARCHITECTURE §9): `category` is the majority (a tie
 * goes to the earliest article; `articles` are oldest first), the rest is the union.
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
		tags: [...tags].slice(0, MAX_EVENT_TAGS)
	};
}

async function extractAndSummarize(
	inputArticles: ArticleRefInput[],
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
			? { title_th: item.event.title_th, summary_th: item.event.summary_th }
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
