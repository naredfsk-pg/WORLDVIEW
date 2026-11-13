/**
 * `AdminRepository`: review queue and editorial writes. Every write appends a `content_revisions`
 * row in the same transaction (audit trail, PRD §9.2). Callers run the admin publish gate first.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { EventStatus, JsonObject, RevisionEntityType } from '../../../types/domain';
import type { ArticleWithSource } from '../../../types/news';
import type {
	AdminEventPatch,
	AdminRepository,
	AdminTransitionResult,
	RevisionMeta
} from '../../../types/repositories';
import type { AdminEventRow, AdminRelationRow } from '../../../types/views';
import type { Db } from '../client';
import {
	articles,
	contentRevisions,
	dailyBriefs,
	eventArticles,
	eventRelations,
	events,
	jobRuns,
	llmCalls,
	sources
} from '../schema';
import { selectEventSources } from './public-read';
import {
	EntityNotFoundError,
	evidenceUrls,
	loadEvidenceUrls,
	toEventSummary,
	toJsonObject,
	type Executor
} from './shared';

export function createAdminRepository(db: Db): AdminRepository {
	return {
		async listReviewQueue() {
			return db.transaction((tx) => ({
				events: selectReviewEvents(tx),
				relations: selectReviewRelations(tx)
			}));
		},

		async countReviewQueue() {
			return db.transaction((tx) => {
				const eventCount = tx
					.select({ n: count() })
					.from(events)
					.where(eq(events.status, 'pending_review'))
					.get();
				const relationCount = tx
					.select({ n: count() })
					.from(eventRelations)
					.where(eq(eventRelations.status, 'pending_review'))
					.get();
				return { events: eventCount?.n ?? 0, relations: relationCount?.n ?? 0 };
			});
		},

		async getEventForEdit(id) {
			return db.transaction((tx) => {
				const event = tx.select().from(events).where(eq(events.id, id)).get();
				if (!event) return null;
				const revisions = tx
					.select()
					.from(contentRevisions)
					.where(and(eq(contentRevisions.entity_type, 'event'), eq(contentRevisions.entity_id, id)))
					.orderBy(desc(contentRevisions.changed_at))
					.all();
				return { event, sources: selectEventSources(tx, id), revisions };
			});
		},

		async updateEvent(id: string, patch: AdminEventPatch, meta: RevisionMeta, now: string) {
			db.transaction((tx) => {
				const before = tx.select().from(events).where(eq(events.id, id)).get();
				if (!before) throw new EntityNotFoundError('event', id);

				const changed = Object.fromEntries(
					Object.entries(patch).filter(([, value]) => value !== undefined)
				) as AdminEventPatch;
				const keys = Object.keys(changed) as (keyof AdminEventPatch)[];
				if (keys.length === 0) return;

				tx.update(events)
					.set({ ...changed, updated_at: now })
					.where(eq(events.id, id))
					.run();
				const previous = Object.fromEntries(keys.map((key) => [key, before[key]]));
				appendRevision(tx, 'event', id, meta, now, toJsonObject(previous), toJsonObject(changed));
			});
		},

		async setEventStatus(id, status, meta, now) {
			db.transaction((tx) => {
				const before = tx.select().from(events).where(eq(events.id, id)).get();
				if (!before) throw new EntityNotFoundError('event', id);

				const publishing = status === 'published';
				tx.update(events)
					.set({
						status,
						updated_at: now,
						published_at: publishing ? (before.published_at ?? now) : before.published_at,
						review_reasons: publishing ? [] : before.review_reasons
					})
					.where(eq(events.id, id))
					.run();
				appendRevision(
					tx,
					'event',
					id,
					meta,
					now,
					{ status: before.status, review_reasons: before.review_reasons },
					{ status }
				);
			});
		},

		async setRelationStatus(id, status, meta, now) {
			db.transaction((tx) => {
				const before = tx.select().from(eventRelations).where(eq(eventRelations.id, id)).get();
				if (!before) throw new EntityNotFoundError('event_relation', id);

				tx.update(eventRelations)
					.set({ status, reviewed_at: now, reviewed_by: meta.changed_by })
					.where(eq(eventRelations.id, id))
					.run();
				appendRevision(tx, 'event_relation', id, meta, now, { status: before.status }, { status });
			});
		},

		async listSourceHealth() {
			return db
				.select({
					id: sources.id,
					name: sources.name,
					enabled: sources.enabled,
					is_demo: sources.is_demo,
					last_success_at: sources.last_success_at,
					last_error_at: sources.last_error_at,
					last_error: sources.last_error
				})
				.from(sources)
				.orderBy(asc(sources.name))
				.all();
		},

		async listHiddenEvents(limit) {
			return db.transaction((tx) => selectReviewEvents(tx, 'hidden', limit));
		},

		async publishEvent(id, gate, meta, now) {
			return db.transaction((tx): AdminTransitionResult => {
				const before = tx.select().from(events).where(eq(events.id, id)).get();
				if (!before) return { ok: false, error: 'not_found' };
				if (!PUBLISHABLE_FROM.includes(before.status)) return { ok: false, error: 'invalid_state' };

				const reasons = gate({ event: before, articles: selectLinkedArticles(tx, id) });
				if (reasons.length > 0) return { ok: false, error: 'gate_failed', reasons };

				tx.update(events)
					.set({
						status: 'published',
						review_reasons: [],
						published_at: before.published_at ?? now,
						updated_at: now
					})
					.where(eq(events.id, id))
					.run();
				appendRevision(
					tx,
					'event',
					id,
					meta,
					now,
					{ status: before.status, review_reasons: before.review_reasons },
					{ status: 'published', review_reasons: [] }
				);
				return { ok: true };
			});
		},

		async hideEvent(id, meta, now) {
			return db.transaction((tx): AdminTransitionResult => {
				const before = tx.select().from(events).where(eq(events.id, id)).get();
				if (!before) return { ok: false, error: 'not_found' };
				if (before.status === 'hidden') return { ok: false, error: 'invalid_state' };

				tx.update(events).set({ status: 'hidden', updated_at: now }).where(eq(events.id, id)).run();
				appendRevision(tx, 'event', id, meta, now, { status: before.status }, { status: 'hidden' });
				return { ok: true };
			});
		},

		async flagEvent(id, meta, now) {
			return db.transaction((tx): AdminTransitionResult => {
				const before = tx.select().from(events).where(eq(events.id, id)).get();
				if (!before) return { ok: false, error: 'not_found' };
				if (!FLAGGABLE_FROM.includes(before.status)) return { ok: false, error: 'invalid_state' };

				const reasons = before.review_reasons.includes('manual_flag')
					? before.review_reasons
					: [...before.review_reasons, 'manual_flag' as const];
				tx.update(events)
					.set({ status: 'pending_review', review_reasons: reasons, updated_at: now })
					.where(eq(events.id, id))
					.run();
				appendRevision(
					tx,
					'event',
					id,
					meta,
					now,
					{ status: before.status, review_reasons: before.review_reasons },
					{ status: 'pending_review', review_reasons: reasons }
				);
				return { ok: true };
			});
		},

		async reviewRelation(id, status, meta, now) {
			return db.transaction((tx): AdminTransitionResult => {
				const before = tx.select().from(eventRelations).where(eq(eventRelations.id, id)).get();
				if (!before) return { ok: false, error: 'not_found' };
				if (before.status !== 'pending_review') return { ok: false, error: 'invalid_state' };

				tx.update(eventRelations)
					.set({ status, reviewed_at: now, reviewed_by: meta.changed_by })
					.where(eq(eventRelations.id, id))
					.run();
				appendRevision(tx, 'event_relation', id, meta, now, { status: before.status }, { status });
				return { ok: true };
			});
		},

		async listRecentBriefs(limit) {
			return db
				.select()
				.from(dailyBriefs)
				.orderBy(desc(dailyBriefs.brief_date), desc(dailyBriefs.generated_at))
				.limit(limit)
				.all();
		},

		async setBriefVisibility(id, status, meta, now) {
			return db.transaction((tx): AdminTransitionResult => {
				const before = tx.select().from(dailyBriefs).where(eq(dailyBriefs.id, id)).get();
				if (!before) return { ok: false, error: 'not_found' };
				const from = status === 'hidden' ? 'published' : 'hidden';
				if (before.status !== from) return { ok: false, error: 'invalid_state' };

				tx.update(dailyBriefs).set({ status }).where(eq(dailyBriefs.id, id)).run();
				appendRevision(tx, 'daily_brief', id, meta, now, { status: before.status }, { status });
				return { ok: true };
			});
		},

		async llmUsageSince(since) {
			return db.transaction((tx) => {
				const calls = tx
					.select({
						requests: count(),
						tokens: sql<number>`coalesce(sum(${llmCalls.tokens_in} + ${llmCalls.tokens_out}), 0)`,
						failures: sql<number>`coalesce(sum(${llmCalls.status} = 'error'), 0)`
					})
					.from(llmCalls)
					.where(gte(llmCalls.created_at, since))
					.get();
				const jobs = tx
					.select({
						cache_hits: sql<number>`coalesce(sum(json_extract(${jobRuns.counters}, '$.llm_cache_hits')), 0)`
					})
					.from(jobRuns)
					.where(gte(jobRuns.started_at, since))
					.get();
				return {
					requests: calls?.requests ?? 0,
					tokens: Number(calls?.tokens ?? 0),
					failures: Number(calls?.failures ?? 0),
					cache_hits: Number(jobs?.cache_hits ?? 0)
				};
			});
		}
	};
}

const PUBLISHABLE_FROM: readonly EventStatus[] = ['draft', 'pending_review', 'hidden'];
const FLAGGABLE_FROM: readonly EventStatus[] = ['draft', 'pending_review'];

/** Linked stored articles with their source, oldest evidence first (input to the admin gate). */
function selectLinkedArticles(tx: Executor, eventId: string): ArticleWithSource[] {
	return tx
		.select({ article: articles, source_name: sources.name, source_is_demo: sources.is_demo })
		.from(eventArticles)
		.innerJoin(articles, eq(articles.id, eventArticles.article_id))
		.innerJoin(sources, eq(sources.id, articles.source_id))
		.where(eq(eventArticles.event_id, eventId))
		.orderBy(asc(articles.ingested_at), asc(articles.id))
		.all()
		.map(({ article, source_name, source_is_demo }) => ({
			...article,
			source_name,
			source_is_demo
		}));
}

function selectReviewEvents(
	tx: Executor,
	status: EventStatus = 'pending_review',
	limit = -1
): AdminEventRow[] {
	const rows = tx
		.select()
		.from(events)
		.where(eq(events.status, status))
		.orderBy(desc(events.last_updated_at))
		.limit(limit)
		.all();
	return rows.map((row) => ({
		id: row.id,
		status: row.status,
		review_reasons: row.review_reasons,
		title_th: row.title_th,
		fallback_title: selectEventSources(tx, row.id)[0]?.title ?? '',
		category: row.category,
		source_count: row.source_count,
		last_updated_at: row.last_updated_at
	}));
}

/** Pending relations between categorized events (relation candidates are always published events). */
function selectReviewRelations(tx: Executor): AdminRelationRow[] {
	const fromEvent = alias(events, 'from_event');
	const toEvent = alias(events, 'to_event');
	const rows = tx
		.select({ relation: eventRelations, from: fromEvent, to: toEvent })
		.from(eventRelations)
		.innerJoin(fromEvent, eq(fromEvent.id, eventRelations.from_event_id))
		.innerJoin(toEvent, eq(toEvent.id, eventRelations.to_event_id))
		.where(
			and(
				eq(eventRelations.status, 'pending_review'),
				isNotNull(fromEvent.category),
				isNotNull(toEvent.category)
			)
		)
		.orderBy(desc(eventRelations.created_at))
		.all();

	const urls = loadEvidenceUrls(
		tx,
		rows.flatMap((row) => row.relation.evidence_refs)
	);
	return rows.map(({ relation, from, to }) => ({
		id: relation.id,
		from_event_id: relation.from_event_id,
		to_event_id: relation.to_event_id,
		relation_type: relation.relation_type,
		explanation_th: relation.explanation_th,
		evidence_source_urls: evidenceUrls(relation.evidence_refs, urls),
		status: relation.status,
		confidence: relation.confidence,
		from_event: toEventSummary(from),
		to_event: toEventSummary(to)
	}));
}

function appendRevision(
	tx: Executor,
	entityType: RevisionEntityType,
	entityId: string,
	meta: RevisionMeta,
	now: string,
	before: JsonObject,
	after: JsonObject
): void {
	tx.insert(contentRevisions)
		.values({
			id: randomUUID(),
			entity_type: entityType,
			entity_id: entityId,
			changed_at: now,
			changed_by: meta.changed_by,
			change_reason: meta.change_reason,
			public_note_th: meta.public_note_th,
			before_after: { before, after }
		})
		.run();
}
