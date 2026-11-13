/**
 * `reevaluate_pending` (ARCHITECTURE §8, §11; auto-publish wave). Applies the CURRENT editorial
 * policy to work an older policy left waiting for an admin, without calling the LLM:
 * - `pending_review` events held only by policy reasons (`auto_publish_disabled`,
 *   `sensitive_single_source`): the auto gate runs again on the stored text
 *   (`evaluateStoredEventForAutoPublish`: G1–G3 on the stored fields, G6 and the policy). The text
 *   already passed G4/G5 against the LLM output when it was saved, so nothing is regenerated. A
 *   published event gets its credibility label from the stored one plus the deterministic floor;
 *   the model's own assessment arrives with its next re-summary. Events with any other reason
 *   are not touched (real gate failures stay pending).
 * - with policy `all` only, published events flagged `new_evidence_pending`: the flag is removed
 *   and `summarized_at` moved back, so the next digest re-summarizes them (the LLM budget applies
 *   there as usual, at most 30 events per run).
 * - with policy `all` only, pending relations: the relation gate runs again on the stored row
 *   (evidence, Thai explanation, G3, confidence threshold): published at or above the threshold,
 *   deleted below it or when an admin rejected the pair. Relations of origin `possible_duplicate`
 *   (a clustering flag) are never listed: they stay pending for an admin.
 * An unpublished event with admin-edited content is never published here: like the digest, it
 * waits as `pending_review [manual_flag]` for that admin.
 * Idempotent: a second run finds nothing left to change. `dryRun` reads and plans only.
 */
import type { ReviewReason } from '#lib/types/domain.js';
import type { AutoPublishPolicy } from '#lib/types/editorial.js';
import type { JobCounters, JobOutcome, Logger } from '#lib/types/jobs.js';
import type { ReevaluationRepository } from '#lib/types/repositories.js';
import {
	assessCredibility,
	countDistinctSources,
	evaluateRelation,
	evaluateStoredEventForAutoPublish,
	filterAllegationTags
} from '../editorial/index.js';
import { sanitizeError } from './runner.js';

/** Reasons that only say "the policy did not allow it", never that something failed. */
export const POLICY_REVIEW_REASONS = [
	'auto_publish_disabled',
	'sensitive_single_source'
] as const satisfies readonly ReviewReason[];

export interface ReevaluateDeps {
	reevaluation: ReevaluationRepository;
	autoPublish: AutoPublishPolicy;
	relationMinConfidence: number;
	dryRun: boolean;
}

export interface ReevaluateContext {
	now: () => Date;
	logger: Logger;
	signal: AbortSignal;
}

export async function runReevaluatePending(
	deps: ReevaluateDeps,
	ctx: ReevaluateContext
): Promise<JobOutcome> {
	const counters = emptyCounters();
	const errors: string[] = [];
	const reason = `policy re-evaluation (EDITORIAL_AUTO_PUBLISH=${deps.autoPublish})`;

	await reevaluateEvents(deps, ctx, reason, counters, errors);
	if (deps.autoPublish === 'all') {
		await requeueNewEvidence(deps, ctx, reason, counters, errors);
		await reevaluateRelations(deps, ctx, reason, counters, errors);
	}

	if (ctx.signal.aborted) errors.unshift('aborted by the job time limit');
	errors.forEach((error) => ctx.logger.error('reevaluate step failed', { error }));
	return {
		status: errors.length > 0 ? 'partial' : 'succeeded',
		counters,
		error: errors.length > 0 ? errors.join('; ').slice(0, 500) : null
	};
}

async function reevaluateEvents(
	deps: ReevaluateDeps,
	ctx: ReevaluateContext,
	reason: string,
	counters: ReevaluateCounters,
	errors: string[]
): Promise<void> {
	const held = await deps.reevaluation.listEventsHeldOnlyBy(POLICY_REVIEW_REASONS);
	for (const { event, articles } of held) {
		if (ctx.signal.aborted) return;
		counters.events_reevaluated++;
		const decision = evaluateStoredEventForAutoPublish({
			event,
			articles,
			auto_publish: deps.autoPublish
		});
		// keep_published / keep_hidden cannot happen: only pending_review events are listed.
		if (decision.status !== 'published' && decision.status !== 'pending_review') continue;
		const unchanged =
			decision.status === 'pending_review' &&
			decision.review_reasons.join() === event.review_reasons.join();
		if (unchanged) {
			logEvent(ctx, event.id, 'unchanged', decision.review_reasons, deps.dryRun);
			counters.events_pending_review++;
			continue;
		}

		const credibility = assessCredibility({
			assessed: { level: event.credibility_level, reason_th: event.credibility_reason_th },
			sensitive: event.signals?.sensitive ?? false,
			distinct_sources: countDistinctSources(articles)
		});
		// The dry run asks the repository too (nothing is written), so it reports an admin hold.
		const written = await tryWrite(errors, `event ${event.id}`, () =>
			deps.reevaluation.applyEventDecision(
				event.id,
				{ status: decision.status, review_reasons: decision.review_reasons, ...credibility },
				{ updated_at: event.updated_at, status: event.status },
				reason,
				ctx.now().toISOString(),
				filterAllegationTags,
				{ dryRun: deps.dryRun }
			)
		);
		// The repository may hold an admin-edited event back (manual_flag) instead of publishing it.
		const held = written === 'pending_review' && decision.status === 'published';
		logEvent(
			ctx,
			event.id,
			written ?? 'skipped',
			held ? ['manual_flag'] : decision.review_reasons,
			deps.dryRun
		);
		if (written === null) counters.events_skipped++;
		else if (written === 'published') counters.events_published++;
		else counters.events_pending_review++;
	}
}

function logEvent(
	ctx: ReevaluateContext,
	eventId: string,
	decision: string,
	reasons: ReviewReason[],
	dryRun: boolean
): void {
	ctx.logger.info('event re-evaluated', {
		event_id: eventId,
		decision,
		reasons,
		dry_run: dryRun
	});
}

async function requeueNewEvidence(
	deps: ReevaluateDeps,
	ctx: ReevaluateContext,
	reason: string,
	counters: ReevaluateCounters,
	errors: string[]
): Promise<void> {
	const flagged = await deps.reevaluation.listPublishedWithNewEvidence();
	for (const event of flagged) {
		if (ctx.signal.aborted) return;
		ctx.logger.info('published event requeued for re-summary', {
			event_id: event.id,
			dry_run: deps.dryRun
		});
		const written =
			deps.dryRun ||
			(await tryWrite(errors, `event ${event.id}`, () =>
				deps.reevaluation.requeueForResummary(
					event.id,
					event.updated_at,
					reason,
					ctx.now().toISOString()
				)
			));
		if (written) counters.events_requeued++;
		else counters.events_skipped++;
	}
}

async function reevaluateRelations(
	deps: ReevaluateDeps,
	ctx: ReevaluateContext,
	reason: string,
	counters: ReevaluateCounters,
	errors: string[]
): Promise<void> {
	const pending = await deps.reevaluation.listPendingRelations();
	for (const item of pending) {
		if (ctx.signal.aborted) return;
		const { relation } = item;
		counters.relations_reevaluated++;
		const decision = item.rejected_pair
			? ({ action: 'drop', reason: 'an admin rejected this pair' } as const)
			: evaluateRelation({
					relation_type: relation.relation_type,
					explanation_th: relation.explanation_th,
					evidence_article_ids: relation.evidence_refs.map((ref) => ref.article_id),
					from_article_ids: item.from_article_ids,
					to_article_ids: item.to_article_ids,
					confidence: relation.confidence,
					auto_publish: deps.autoPublish,
					min_confidence: deps.relationMinConfidence
				});
		const publish = decision.action === 'store' && decision.status === 'published';
		ctx.logger.info('relation re-evaluated', {
			relation_id: relation.id,
			decision: publish ? 'published' : decision.action,
			...(decision.action === 'drop' ? { reason: decision.reason } : {}),
			dry_run: deps.dryRun
		});
		if (decision.action === 'store' && !publish) {
			counters.relations_pending_review++;
			continue;
		}
		const now = ctx.now().toISOString();
		const written =
			deps.dryRun ||
			(await tryWrite(errors, `relation ${relation.id}`, () =>
				publish
					? deps.reevaluation.publishPendingRelation(relation.id, reason, now)
					: deps.reevaluation.dropPendingRelation(relation.id, reason, now)
			));
		if (!written) {
			counters.relations_skipped++;
			continue;
		}
		if (publish) counters.relations_published++;
		else counters.relations_dropped++;
	}
}

/** One unit's write; a failure is recorded and the run goes on (the run becomes `partial`). */
async function tryWrite<T>(
	errors: string[],
	unit: string,
	write: () => Promise<T>
): Promise<T | null> {
	try {
		return await write();
	} catch (error) {
		errors.push(`${unit}: ${sanitizeError(error)}`);
		return null;
	}
}

type ReevaluateCounters = ReturnType<typeof emptyCounters>;

function emptyCounters() {
	return {
		events_reevaluated: 0,
		events_published: 0,
		events_pending_review: 0,
		events_requeued: 0,
		events_skipped: 0,
		relations_reevaluated: 0,
		relations_published: 0,
		relations_dropped: 0,
		relations_pending_review: 0,
		relations_skipped: 0
	} satisfies JobCounters;
}
