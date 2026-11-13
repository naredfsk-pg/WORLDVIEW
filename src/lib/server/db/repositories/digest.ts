/**
 * `DigestRepository`: article taxonomy, event creation/linking, content saves, relations and
 * lesson links. Derived event fields (first_seen_at, event_date, last_updated_at, source_count,
 * is_demo) are always recomputed from the stored evidence inside the same transaction.
 */
import { randomUUID } from 'node:crypto';
import {
	and,
	asc,
	desc,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	max,
	ne,
	not,
	notInArray,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { ReviewReason } from '../../../types/domain';
import type { ArticleWithSource, EventMatchCandidate } from '../../../types/news';
import type {
	DigestRepository,
	EventContentWrite,
	EventWithArticles
} from '../../../types/repositories';
import { toBriefDate } from '../../../utils/date';
import type { Db } from '../client';
import {
	academyLessons,
	articles,
	contentRevisions,
	eventArticles,
	eventLessonLinks,
	eventRelations,
	eventUpdates,
	events,
	sources
} from '../schema';
import { EntityNotFoundError, isPublicEvent, toJsonObject, type Executor } from './shared';

/** `content_revisions.changed_by` of pipeline changes; every other actor is an admin email. */
export const SYSTEM_ACTOR = 'system';

export function createDigestRepository(db: Db): DigestRepository {
	return {
		async listUnassignedArticles(since, limit) {
			const rows = db
				.select({ article: articles, source_name: sources.name, source_is_demo: sources.is_demo })
				.from(articles)
				.innerJoin(sources, eq(sources.id, articles.source_id))
				.leftJoin(eventArticles, eq(eventArticles.article_id, articles.id))
				.where(and(isNull(eventArticles.event_id), gte(articles.ingested_at, since)))
				.orderBy(asc(articles.ingested_at), asc(articles.id))
				.limit(limit)
				.all();
			return rows.map(toArticleWithSource);
		},

		async saveArticleTaxonomy(articleId, taxonomy) {
			db.update(articles).set({ taxonomy }).where(eq(articles.id, articleId)).run();
		},

		async listMatchableEvents(since) {
			return db.transaction((tx) => {
				const rows = tx
					.select()
					.from(events)
					.where(and(ne(events.status, 'hidden'), gte(events.last_updated_at, since)))
					// id breaks ties, so grouping sees the same order on every run.
					.orderBy(desc(events.last_updated_at), asc(events.id))
					.all();
				const articlesByEvent = loadArticlesByEvent(
					tx,
					rows.map((row) => row.id)
				);
				return rows.map((row): EventMatchCandidate => {
					const titles = (articlesByEvent.get(row.id) ?? []).map((article) => article.title);
					return {
						event_id: row.id,
						title: row.title_th || titles[0] || '',
						tags: row.tags,
						first_seen_at: row.first_seen_at,
						last_updated_at: row.last_updated_at,
						article_titles: titles,
						is_demo: row.is_demo
					};
				});
			});
		},

		async createDraftEvent(articleIds, confidence, now) {
			if (articleIds.length === 0) throw new Error('createDraftEvent needs at least one article');

			return db.transaction(
				(tx) => {
					const id = randomUUID();
					tx.insert(events)
						.values({
							id,
							status: 'draft',
							review_reasons: [],
							title_th: '',
							summary_th: '',
							what_happened_th: '',
							why_it_matters_th: '',
							background_th: null,
							uncertain_th: null,
							claims: [],
							category: null,
							regions: [],
							countries: [],
							tags: [],
							signals: null,
							occurred_at: null,
							// Placeholders; recomputeDerivedFields replaces them from the linked articles.
							first_seen_at: now,
							event_date: toBriefDate(now),
							last_updated_at: now,
							published_at: null,
							summarized_at: null,
							source_count: 0,
							is_demo: false,
							created_at: now,
							updated_at: now
						})
						.run();
					const linked = insertEventArticles(tx, id, articleIds, confidence, now);
					if (linked === 0) {
						// Every article already belongs to another event: roll back instead of leaving an empty draft.
						throw new Error('createDraftEvent: all articles are already linked to an event');
					}
					recomputeDerivedFields(tx, id, now);
					return id;
				},
				{ behavior: 'immediate' }
			);
		},

		async linkArticles(eventId, articleIds, confidence, now) {
			db.transaction(
				(tx) => {
					assertEventExists(tx, eventId);
					insertEventArticles(tx, eventId, articleIds, confidence, now);
					recomputeDerivedFields(tx, eventId, now);
				},
				{ behavior: 'immediate' }
			);
		},

		async listEventsNeedingContent(limit) {
			return db.transaction((tx) => {
				const onlyLlmFailed = sql`json_array_length(${events.review_reasons}) = 1 AND json_extract(${events.review_reasons}, '$[0]') = 'llm_failed'`;
				const linkedAfterSummary = exists(
					tx
						.select({ one: sql`1` })
						.from(eventArticles)
						.where(
							and(
								eq(eventArticles.event_id, events.id),
								or(isNull(events.summarized_at), gt(eventArticles.linked_at, events.summarized_at))
							)
						)
				);
				// An editor's flag on a published event is final for the pipeline (the gate would only
				// answer keep_published), so it is not even sent to the LLM.
				const hasManualFlag = sql`EXISTS (SELECT 1 FROM json_each(${events.review_reasons}) WHERE value = 'manual_flag')`;
				const rows = tx
					.select()
					.from(events)
					.where(
						or(
							eq(events.status, 'draft'),
							and(eq(events.status, 'pending_review'), onlyLlmFailed),
							and(eq(events.status, 'published'), linkedAfterSummary, not(hasManualFlag))
						)
					)
					.orderBy(desc(events.last_updated_at), asc(events.id))
					.limit(limit)
					.all();
				return withArticles(tx, rows);
			});
		},

		async saveEventContent(eventId, content, now) {
			return db.transaction(
				(tx) => {
					const before = tx.select().from(events).where(eq(events.id, eventId)).get();
					if (!before) throw new EntityNotFoundError('event', eventId);
					if (before.status === 'hidden') {
						throw new Error(`saveEventContent: event ${eventId} is hidden by an admin`);
					}
					if (before.status === 'published' && content.status !== 'published') {
						// ARCHITECTURE §6: never auto-demote; the caller must keep the published text instead.
						throw new Error(`saveEventContent: published event ${eventId} cannot be demoted`);
					}

					// Admin corrections win over the pipeline (PRD FR-06, §9.2): fields an admin ever
					// edited are never rewritten. Checked inside this transaction, so an admin save
					// cannot slip in between the check and the write.
					const adminFields = adminEditedContentFields(tx, eventId);
					const contentFields = Object.fromEntries(
						Object.entries(pickContentFields(content)).filter(([key]) => !adminFields.has(key))
					) as Partial<ReturnType<typeof pickContentFields>>;
					// An admin who edited an unpublished event publishes it themselves.
					const awaitsAdmin =
						adminFields.size > 0 && before.status !== 'published' && content.status === 'published';
					const status = awaitsAdmin ? 'pending_review' : content.status;
					const publishing = status === 'published';
					let reviewReasons: ReviewReason[] = [];
					if (awaitsAdmin) reviewReasons = ['manual_flag'];
					else if (!publishing) reviewReasons = content.review_reasons;
					tx.update(events)
						.set({
							...contentFields,
							status,
							review_reasons: reviewReasons,
							summarized_at: content.summarized_at,
							published_at: publishing ? (before.published_at ?? now) : before.published_at,
							updated_at: now
						})
						.where(eq(events.id, eventId))
						.run();

					if (content.new_updates.length > 0) {
						tx.insert(eventUpdates)
							.values(
								content.new_updates.map((update) => ({
									...update,
									id: randomUUID(),
									event_id: eventId,
									created_at: now
								}))
							)
							.run();
					}
					recomputeDerivedFields(tx, eventId, now);

					if (before.status === 'published') {
						// Automated change to already-public content: keep an audit trail.
						tx.insert(contentRevisions)
							.values({
								id: randomUUID(),
								entity_type: 'event',
								entity_id: eventId,
								changed_at: now,
								changed_by: SYSTEM_ACTOR,
								change_reason:
									adminFields.size > 0
										? 'automatic re-summary after new evidence; admin-edited fields kept'
										: 'automatic re-summary after new evidence',
								public_note_th: null,
								before_after: {
									before: toJsonObject(pickContentFields(before)),
									after: toJsonObject(contentFields)
								}
							})
							.run();
					}
					const stored = tx.select().from(events).where(eq(events.id, eventId)).get()!;
					return { status, admin_fields_kept: [...adminFields].sort(), event: stored };
				},
				{ behavior: 'immediate' }
			);
		},

		async markEventForReview(eventId: string, reasons: ReviewReason[], now: string) {
			// Published (and hidden) events are left untouched: never auto-demote.
			db.update(events)
				.set({ status: 'pending_review', review_reasons: reasons, updated_at: now })
				.where(and(eq(events.id, eventId), inArray(events.status, ['draft', 'pending_review'])))
				.run();
		},

		async markContentChecked(eventId, checkedAt) {
			// Only moves forward, and only for published events (their text stays as it is).
			db.update(events)
				.set({ summarized_at: checkedAt })
				.where(
					and(
						eq(events.id, eventId),
						eq(events.status, 'published'),
						or(isNull(events.summarized_at), lt(events.summarized_at, checkedAt))
					)
				)
				.run();
		},

		async mergeDraftEvent(sourceEventId, targetEventId, confidence, now) {
			return db.transaction(
				(tx) => {
					const source = tx
						.select({ status: events.status, is_demo: events.is_demo })
						.from(events)
						.where(eq(events.id, sourceEventId))
						.get();
					const target = tx
						.select({ status: events.status, is_demo: events.is_demo })
						.from(events)
						.where(eq(events.id, targetEventId))
						.get();
					if (!source) throw new EntityNotFoundError('event', sourceEventId);
					if (!target) throw new EntityNotFoundError('event', targetEventId);
					if (source.status !== 'draft' || target.status === 'hidden') {
						throw new Error(
							`mergeDraftEvent: cannot merge a ${source.status} event into a ${target.status} event`
						);
					}
					if (source.is_demo !== target.is_demo) {
						throw new Error('mergeDraftEvent: real and demo events are never merged');
					}
					// Deleting the draft would delete an editor's work: leave both events as they are.
					if (hasAdminRevision(tx, sourceEventId)) return false;

					tx.update(eventArticles)
						.set({ event_id: targetEventId, relation_confidence: confidence, linked_at: now })
						.where(eq(eventArticles.event_id, sourceEventId))
						.run();
					// A draft has no public content; its updates, relations and links cascade away.
					tx.delete(events).where(eq(events.id, sourceEventId)).run();
					recomputeDerivedFields(tx, targetEventId, now);
					return true;
				},
				{ behavior: 'immediate' }
			);
		},

		async listRelationCandidates(eventId, since, limit) {
			return db.transaction((tx) => {
				const source = tx
					.select({ regions: events.regions, tags: events.tags, is_demo: events.is_demo })
					.from(events)
					.where(eq(events.id, eventId))
					.get();
				if (!source) return [];

				const sharesTag = sharesJsonValue(events.tags, source.tags);
				// `global` is on most stories, so it says nothing about a relation.
				const sharesRegion = sharesJsonValue(
					events.regions,
					source.regions.filter((region) => region !== 'global')
				);
				if (!sharesTag && !sharesRegion) return [];

				const rows = tx
					.select()
					.from(events)
					.where(
						and(
							ne(events.id, eventId),
							isPublicEvent(events),
							// Real events never relate to fictional demo events (and vice versa).
							eq(events.is_demo, source.is_demo),
							gte(events.last_updated_at, since),
							or(sharesTag, sharesRegion)
						)
					)
					.orderBy(desc(events.last_updated_at), asc(events.id))
					.limit(limit)
					.all();
				return withArticles(tx, rows);
			});
		},

		async upsertRelation(relation) {
			// same_topic is symmetric and stored with from_event_id < to_event_id (types/domain.ts).
			const swap =
				relation.relation_type === 'same_topic' && relation.from_event_id > relation.to_event_id;
			const from_event_id = swap ? relation.to_event_id : relation.from_event_id;
			const to_event_id = swap ? relation.from_event_id : relation.to_event_id;

			db.insert(eventRelations)
				.values({
					...relation,
					id: randomUUID(),
					from_event_id,
					to_event_id,
					// CONTRACT-GAP: upsertRelation has no `now` parameter, so the clock is read here.
					created_at: new Date().toISOString(),
					reviewed_at: null,
					reviewed_by: null
				})
				.onConflictDoUpdate({
					target: [
						eventRelations.from_event_id,
						eventRelations.to_event_id,
						eventRelations.relation_type
					],
					set: {
						explanation_th: relation.explanation_th,
						evidence_refs: relation.evidence_refs,
						status: relation.status,
						confidence: relation.confidence
					},
					// Never overwrite an admin decision.
					setWhere: isNull(eventRelations.reviewed_at)
				})
				.run();
		},

		async replaceLessonLinks(eventId, links) {
			db.transaction((tx) => {
				const keepIds = links.map((link) => link.lesson_id);
				tx.delete(eventLessonLinks)
					.where(
						and(
							eq(eventLessonLinks.event_id, eventId),
							keepIds.length > 0 ? notInArray(eventLessonLinks.lesson_id, keepIds) : undefined
						)
					)
					.run();

				// CONTRACT-GAP: replaceLessonLinks has no `now` parameter, so the clock is read here.
				const createdAt = new Date().toISOString();
				for (const link of links) {
					tx.insert(eventLessonLinks)
						.values({ ...link, event_id: eventId, created_at: createdAt })
						.onConflictDoUpdate({
							target: [eventLessonLinks.event_id, eventLessonLinks.lesson_id],
							set: { rationale_th: link.rationale_th, evidence_refs: link.evidence_refs }
						})
						.run();
				}
			});
		},

		async listLessonCatalog() {
			return db.select().from(academyLessons).orderBy(asc(academyLessons.day)).all();
		}
	};
}

/** `column` (a JSON array) contains any of `values`; undefined when `values` is empty. */
function sharesJsonValue(column: SQLiteColumn, values: readonly string[]): SQL | undefined {
	if (values.length === 0) return undefined;
	return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE ${inArray(sql`value`, [...values])})`;
}

/** Derived event facts from its evidence. Pure; also used by the demo seed. */
export function deriveEventFacts(
	linked: {
		published_at: string | null;
		ingested_at: string;
		publisher_name: string;
		is_demo: boolean;
	}[],
	updateReportedAts: string[]
): {
	first_seen_at: string;
	event_date: string;
	last_updated_at: string;
	source_count: number;
	is_demo: boolean;
} {
	if (linked.length === 0) throw new Error('deriveEventFacts needs at least one linked article');

	// UTC ISO strings sort lexically, so string min/max is chronological.
	const seenTimes = linked.map((article) => article.published_at ?? article.ingested_at).sort();
	const evidenceTimes = [...seenTimes, ...updateReportedAts].sort();
	const firstSeenAt = seenTimes[0]!;
	return {
		first_seen_at: firstSeenAt,
		event_date: toBriefDate(firstSeenAt),
		last_updated_at: evidenceTimes[evidenceTimes.length - 1]!,
		source_count: new Set(linked.map((article) => article.publisher_name)).size,
		is_demo: linked.some((article) => article.is_demo)
	};
}

function recomputeDerivedFields(tx: Executor, eventId: string, now: string): void {
	const linked = tx
		.select({
			published_at: articles.published_at,
			ingested_at: articles.ingested_at,
			publisher_name: articles.publisher_name,
			is_demo: sources.is_demo
		})
		.from(eventArticles)
		.innerJoin(articles, eq(articles.id, eventArticles.article_id))
		.innerJoin(sources, eq(sources.id, articles.source_id))
		.where(eq(eventArticles.event_id, eventId))
		.all();
	if (linked.length === 0) return;

	const latestUpdate = tx
		.select({ at: max(eventUpdates.reported_at) })
		.from(eventUpdates)
		.where(eq(eventUpdates.event_id, eventId))
		.get();
	const facts = deriveEventFacts(linked, latestUpdate?.at ? [latestUpdate.at] : []);
	tx.update(events)
		.set({ ...facts, updated_at: now })
		.where(eq(events.id, eventId))
		.run();
}

/** Returns how many links were created; articles already linked to any event are skipped. */
function insertEventArticles(
	tx: Executor,
	eventId: string,
	articleIds: string[],
	confidence: number,
	now: string
): number {
	let linked = 0;
	for (const articleId of articleIds) {
		const result = tx
			.insert(eventArticles)
			.values({
				event_id: eventId,
				article_id: articleId,
				relation_confidence: confidence,
				linked_at: now
			})
			.onConflictDoNothing()
			.run();
		linked += result.changes;
	}
	return linked;
}

/**
 * Content fields an admin ever changed on this event: the `after` keys of every event revision
 * whose actor is not the pipeline. All of them, not only those newer than `summarized_at`: once
 * a re-summary kept an admin field, `summarized_at` moves past the edit, and the next re-summary
 * must still keep it.
 */
function adminEditedContentFields(tx: Executor, eventId: string): Set<string> {
	const rows = tx
		.select({ before_after: contentRevisions.before_after })
		.from(contentRevisions)
		.where(
			and(
				eq(contentRevisions.entity_type, 'event'),
				eq(contentRevisions.entity_id, eventId),
				ne(contentRevisions.changed_by, SYSTEM_ACTOR)
			)
		)
		.all();
	const fields = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row.before_after.after ?? {})) {
			if (CONTENT_FIELD_KEYS.has(key)) fields.add(key);
		}
	}
	return fields;
}

function hasAdminRevision(tx: Executor, eventId: string): boolean {
	const row = tx
		.select({ id: contentRevisions.id })
		.from(contentRevisions)
		.where(
			and(
				eq(contentRevisions.entity_type, 'event'),
				eq(contentRevisions.entity_id, eventId),
				ne(contentRevisions.changed_by, SYSTEM_ACTOR)
			)
		)
		.get();
	return row !== undefined;
}

function assertEventExists(tx: Executor, eventId: string): void {
	const row = tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get();
	if (!row) throw new EntityNotFoundError('event', eventId);
}

const CONTENT_FIELD_KEYS: ReadonlySet<string> = new Set([
	'title_th',
	'summary_th',
	'what_happened_th',
	'why_it_matters_th',
	'background_th',
	'uncertain_th',
	'claims',
	'category',
	'regions',
	'countries',
	'tags',
	'signals',
	'occurred_at'
]);

function pickContentFields(source: EventContentWrite | typeof events.$inferSelect) {
	return {
		title_th: source.title_th,
		summary_th: source.summary_th,
		what_happened_th: source.what_happened_th,
		why_it_matters_th: source.why_it_matters_th,
		background_th: source.background_th,
		uncertain_th: source.uncertain_th,
		claims: source.claims,
		category: source.category,
		regions: source.regions,
		countries: source.countries,
		tags: source.tags,
		signals: source.signals,
		occurred_at: source.occurred_at
	};
}

function withArticles(tx: Executor, rows: (typeof events.$inferSelect)[]): EventWithArticles[] {
	const articlesByEvent = loadArticlesByEvent(
		tx,
		rows.map((row) => row.id)
	);
	return rows.map((event) => ({ event, articles: articlesByEvent.get(event.id) ?? [] }));
}

/** Linked articles per event, oldest evidence first. */
function loadArticlesByEvent(tx: Executor, eventIds: string[]): Map<string, ArticleWithSource[]> {
	const byEvent = new Map<string, ArticleWithSource[]>();
	if (eventIds.length === 0) return byEvent;

	const rows = tx
		.select({
			event_id: eventArticles.event_id,
			article: articles,
			source_name: sources.name,
			source_is_demo: sources.is_demo
		})
		.from(eventArticles)
		.innerJoin(articles, eq(articles.id, eventArticles.article_id))
		.innerJoin(sources, eq(sources.id, articles.source_id))
		.where(inArray(eventArticles.event_id, eventIds))
		.orderBy(sql`coalesce(${articles.published_at}, ${articles.ingested_at})`, asc(articles.id))
		.all();
	for (const row of rows) {
		const list = byEvent.get(row.event_id) ?? [];
		list.push(toArticleWithSource(row));
		byEvent.set(row.event_id, list);
	}
	return byEvent;
}

function toArticleWithSource(row: {
	article: typeof articles.$inferSelect;
	source_name: string;
	source_is_demo: boolean;
}): ArticleWithSource {
	return { ...row.article, source_name: row.source_name, source_is_demo: row.source_is_demo };
}
