/**
 * `ReevaluationRepository`: the writes of the `reevaluate_pending` job (ARCHITECTURE §8, §11).
 * Each method is one transaction that re-reads the row, writes only while it is still as listed,
 * and appends a `content_revisions` row by `POLICY_ACTOR` (`system:policy`).
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
	JsonObject,
	NewsEvent,
	ReviewReason,
	RevisionEntityType
} from '../../../types/domain';
import type { PendingRelationForReview, ReevaluationRepository } from '../../../types/repositories';
import type { Db } from '../client';
import { contentRevisions, eventArticles, eventRelations, events } from '../schema';
import { adminEditedContentFields, isRejectedPair, withArticles } from './digest';
import { POLICY_ACTOR, SYSTEM_ACTOR, toJsonObject, type Executor } from './shared';

export function createReevaluationRepository(db: Db): ReevaluationRepository {
	return {
		async listEventsHeldOnlyBy(reasons) {
			return db.transaction((tx) => {
				const allowed = sql.join(
					reasons.map((reason) => sql`${reason}`),
					sql`, `
				);
				const rows = tx
					.select()
					.from(events)
					.where(
						and(
							eq(events.status, 'pending_review'),
							sql`json_array_length(${events.review_reasons}) > 0`,
							sql`NOT EXISTS (SELECT 1 FROM json_each(${events.review_reasons}) WHERE value NOT IN (${allowed}))`
						)
					)
					.orderBy(desc(events.last_updated_at), events.id)
					.all();
				return withArticles(tx, rows);
			});
		},

		async listPublishedWithNewEvidence() {
			return db
				.select()
				.from(events)
				.where(
					and(
						eq(events.status, 'published'),
						sql`EXISTS (SELECT 1 FROM json_each(${events.review_reasons}) WHERE value = 'new_evidence_pending')`
					)
				)
				.orderBy(desc(events.last_updated_at), events.id)
				.all();
		},

		async applyEventDecision(eventId, write, listed, changeReason, now, publicTags, options = {}) {
			return db.transaction(
				(tx) => {
					const before = tx.select().from(events).where(eq(events.id, eventId)).get();
					if (!before || before.updated_at !== listed.updated_at) return null;
					if (before.status !== listed.status) return null;

					// Admin corrections win, as in saveEventContent: fields an admin edited are kept,
					// and an unpublished event an admin edited waits for that admin (manual_flag).
					const adminFields = adminEditedContentFields(tx, eventId);
					const awaitsAdmin =
						adminFields.size > 0 && before.status !== 'published' && write.status === 'published';
					const status = awaitsAdmin ? 'pending_review' : write.status;
					if (options.dryRun) return status;
					const credibility = adminFields.has('credibility_level')
						? {}
						: {
								credibility_level: write.credibility_level,
								credibility_reason_th: write.credibility_reason_th
							};
					const publishing = status === 'published';
					const tags =
						publishing && !adminFields.has('tags') ? publicTags(before.tags) : before.tags;
					let reviewReasons: ReviewReason[] = [];
					if (awaitsAdmin) reviewReasons = ['manual_flag'];
					else if (!publishing) reviewReasons = write.review_reasons;
					const change = {
						status,
						review_reasons: reviewReasons,
						...credibility,
						...(tags.length !== before.tags.length ? { tags } : {})
					};
					tx.update(events)
						.set({
							...change,
							published_at: publishing ? (before.published_at ?? now) : before.published_at,
							updated_at: now
						})
						.where(eq(events.id, eventId))
						.run();
					appendPolicyRevision(
						tx,
						'event',
						eventId,
						changeReason,
						now,
						pick(before, change),
						toJsonObject(change)
					);
					return status;
				},
				{ behavior: 'immediate' }
			);
		},

		async requeueForResummary(eventId, listedUpdatedAt, changeReason, now) {
			return db.transaction(
				(tx) => {
					const before = tx.select().from(events).where(eq(events.id, eventId)).get();
					if (!before || before.status !== 'published' || before.updated_at !== listedUpdatedAt) {
						return false;
					}
					const change = {
						review_reasons: before.review_reasons.filter(
							(reason: ReviewReason) => reason !== 'new_evidence_pending'
						),
						summarized_at: lastContentSave(tx, before)
					};
					tx.update(events)
						.set({ ...change, updated_at: now })
						.where(eq(events.id, eventId))
						.run();
					appendPolicyRevision(
						tx,
						'event',
						eventId,
						changeReason,
						now,
						pick(before, change),
						toJsonObject(change)
					);
					return true;
				},
				{ behavior: 'immediate' }
			);
		},

		async listPendingRelations() {
			return db.transaction((tx) => {
				const rows = tx
					.select()
					.from(eventRelations)
					.where(
						and(
							eq(eventRelations.status, 'pending_review'),
							// A possible-duplicate relation belongs to that admin review (§11).
							eq(eventRelations.origin, 'relations')
						)
					)
					.orderBy(eventRelations.created_at, eventRelations.id)
					.all();
				return rows.map((relation): PendingRelationForReview => ({
					relation,
					from_article_ids: linkedArticleIds(tx, relation.from_event_id),
					to_article_ids: linkedArticleIds(tx, relation.to_event_id),
					rejected_pair: isRejectedPair(tx, relation.from_event_id, relation.to_event_id)
				}));
			});
		},

		async publishPendingRelation(relationId, changeReason, now) {
			return db.transaction(
				(tx) => {
					// Re-checked here: an admin may have rejected the pair since it was listed.
					const row = tx
						.select()
						.from(eventRelations)
						.where(eq(eventRelations.id, relationId))
						.get();
					if (!row || row.status !== 'pending_review' || row.origin !== 'relations') return false;
					if (isRejectedPair(tx, row.from_event_id, row.to_event_id)) return false;
					tx.update(eventRelations)
						.set({ status: 'published' })
						.where(eq(eventRelations.id, relationId))
						.run();
					appendPolicyRevision(
						tx,
						'event_relation',
						relationId,
						changeReason,
						now,
						{ status: 'pending_review' },
						{ status: 'published' }
					);
					return true;
				},
				{ behavior: 'immediate' }
			);
		},

		async dropPendingRelation(relationId, changeReason, now) {
			return db.transaction(
				(tx) => {
					const before = tx
						.select()
						.from(eventRelations)
						.where(
							and(
								eq(eventRelations.id, relationId),
								eq(eventRelations.status, 'pending_review'),
								eq(eventRelations.origin, 'relations')
							)
						)
						.get();
					if (!before) return false;
					tx.delete(eventRelations).where(eq(eventRelations.id, relationId)).run();
					appendPolicyRevision(
						tx,
						'event_relation',
						relationId,
						changeReason,
						now,
						toJsonObject(before),
						null
					);
					return true;
				},
				{ behavior: 'immediate' }
			);
		}
	};
}

/** The before values of exactly the keys a change writes (the audit row's `before`). */
function pick(row: NewsEvent, change: object): JsonObject {
	const keys = Object.keys(change) as (keyof NewsEvent)[];
	return toJsonObject(Object.fromEntries(keys.map((key) => [key, row[key]])));
}

/**
 * When the published text was last written: the later of the first publication and the last
 * automatic re-summary revision. Articles linked after it are the ones the text has not seen.
 */
function lastContentSave(tx: Executor, event: NewsEvent): string | null {
	const lastResummary = tx
		.select({ changed_at: contentRevisions.changed_at })
		.from(contentRevisions)
		.where(
			and(
				eq(contentRevisions.entity_type, 'event'),
				eq(contentRevisions.entity_id, event.id),
				eq(contentRevisions.changed_by, SYSTEM_ACTOR),
				sql`${contentRevisions.change_reason} LIKE 'automatic re-summary%'`
			)
		)
		.orderBy(desc(contentRevisions.changed_at))
		.get();
	const candidates = [event.published_at, lastResummary?.changed_at ?? null].filter(
		(value): value is string => value !== null
	);
	// UTC ISO strings compare chronologically.
	return candidates.sort().at(-1) ?? null;
}

function linkedArticleIds(tx: Executor, eventId: string): string[] {
	return tx
		.select({ id: eventArticles.article_id })
		.from(eventArticles)
		.where(eq(eventArticles.event_id, eventId))
		.all()
		.map((row) => row.id);
}

function appendPolicyRevision(
	tx: Executor,
	entityType: RevisionEntityType,
	entityId: string,
	changeReason: string,
	now: string,
	before: JsonObject | null,
	after: JsonObject | null
): void {
	tx.insert(contentRevisions)
		.values({
			id: randomUUID(),
			entity_type: entityType,
			entity_id: entityId,
			changed_at: now,
			changed_by: POLICY_ACTOR,
			change_reason: changeReason,
			public_note_th: null,
			before_after: { before, after }
		})
		.run();
}
