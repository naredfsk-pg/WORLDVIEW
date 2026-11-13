/**
 * Grouping step: links unassigned recent articles to matching recent events, or creates draft
 * events, using the rule-based `planGrouping` (no LLM yet). Runs at the end of every ingest so
 * fresh articles become event candidates; digest (Wave 2) can call it again after tagging.
 * Idempotent: only unassigned articles are considered and `article_id` is UNIQUE in event_articles.
 */
import type { ArticleWithSource } from '#lib/types/news.js';
import type { JobContext } from '#lib/types/jobs.js';
import type { DigestRepository } from '#lib/types/repositories.js';
import { GROUPING_CONFIG, planGrouping, type GroupableArticle } from '../news/grouping.js';

/** ARCHITECTURE §9 digest step 1: unassigned articles from the last 72 h, at most 200 per run. */
export const GROUPING_LOOKBACK_MS = GROUPING_CONFIG.timeWindowMs;
export const GROUPING_BATCH_LIMIT = 200;

export async function groupUnassignedArticles(
	digest: Pick<
		DigestRepository,
		'listUnassignedArticles' | 'listMatchableEvents' | 'createDraftEvent' | 'linkArticles'
	>,
	ctx: Pick<JobContext, 'now' | 'logger'>
): Promise<{ articles_grouped: number; events_created: number; events_updated: number }> {
	const now = ctx.now();
	const since = new Date(now.getTime() - GROUPING_LOOKBACK_MS).toISOString();
	const articles = await digest.listUnassignedArticles(since, GROUPING_BATCH_LIMIT);
	if (articles.length === 0) return { articles_grouped: 0, events_created: 0, events_updated: 0 };

	const events = await digest.listMatchableEvents(since);
	const plan = planGrouping(articles.map(toGroupableArticle), events);
	const nowIso = now.toISOString();
	for (const join of plan.joins) {
		await digest.linkArticles(join.event_id, join.article_ids, join.confidence, nowIso);
	}
	for (const group of plan.new_events) {
		await digest.createDraftEvent(group.article_ids, group.confidence, nowIso);
	}

	const grouped = [...plan.joins, ...plan.new_events].reduce(
		(sum, group) => sum + group.article_ids.length,
		0
	);
	ctx.logger.info('articles grouped', {
		articles_grouped: grouped,
		events_created: plan.new_events.length,
		events_updated: plan.joins.length,
		ambiguous_as_new: plan.ambiguous_count
	});
	return {
		articles_grouped: grouped,
		events_created: plan.new_events.length,
		events_updated: plan.joins.length
	};
}

function toGroupableArticle(article: ArticleWithSource): GroupableArticle {
	const categories = article.raw_metadata['categories'];
	return {
		id: article.id,
		title: article.title,
		published_at: article.published_at,
		ingested_at: article.ingested_at,
		categories: Array.isArray(categories)
			? categories.filter((category): category is string => typeof category === 'string')
			: []
	};
}
