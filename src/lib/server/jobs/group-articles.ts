/**
 * Grouping step: links unassigned recent articles to matching recent events, or creates draft
 * events, using the rule-based `planGrouping` (no LLM). Runs at the end of every ingest so fresh
 * articles become event candidates, and again at the start of digest for anything an aborted or
 * failed ingest left unassigned. Ambiguous matches become new events here; digest asks the LLM
 * `clustering` task about them afterwards.
 * Real and demo content never mix: each group is planned only against events of the same kind.
 * Idempotent: only unassigned articles are considered and `article_id` is UNIQUE in event_articles.
 */
import type { JobContext } from '#lib/types/jobs.js';
import type { DigestRepository } from '#lib/types/repositories.js';
import { GROUPING_CONFIG, planGrouping, type GroupingPlan } from '../news/grouping.js';

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
	// Only title and times are used; feed categories are deliberately ignored (see grouping.ts).
	const plan = mergePlans(
		[true, false].map((isDemo) =>
			planGrouping(
				articles.filter((article) => article.source_is_demo === isDemo),
				events.filter((event) => event.is_demo === isDemo)
			)
		)
	);
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

function mergePlans(plans: GroupingPlan[]): GroupingPlan {
	return {
		joins: plans.flatMap((plan) => plan.joins),
		new_events: plans.flatMap((plan) => plan.new_events),
		ambiguous_count: plans.reduce((sum, plan) => sum + plan.ambiguous_count, 0)
	};
}
