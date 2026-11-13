/**
 * `PublicReadRepository`: everything public pages read. Only published content leaves this file:
 * events must pass `isReadableEvent` (published, categorized, with a stored source), briefs must
 * be `published`, relations must be `published` with both endpoints readable and with resolvable
 * evidence.
 */
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type {
	BriefDate,
	BriefEdition,
	CategorySlug,
	IsoUtc,
	YearMonth
} from '../../../types/domain';
import { BRIEF_EDITIONS } from '../../../types/domain';
import type { PublicReadRepository } from '../../../types/repositories';
import type { BriefView, EventDetail, RelationView, SourceRef } from '../../../types/views';
import {
	academyLessons,
	articles,
	contentRevisions,
	dailyBriefEvents,
	dailyBriefs,
	eventArticles,
	eventLessonLinks,
	eventRelations,
	eventUpdates,
	events,
	jobRuns
} from '../schema';
import type { Db } from '../client';
import { searchEvents, searchLessons } from './search';
import {
	evidenceUrls,
	isReadableEvent,
	loadEvidenceUrls,
	toEventSummary,
	toLessonSummary,
	type Executor
} from './shared';

/** Best edition first when the caller does not ask for one (ARCHITECTURE §3). */
const EDITION_PREFERENCE: readonly BriefEdition[] = ['daily_snapshot', 'evening', 'morning'];

export function createPublicReadRepository(db: Db): PublicReadRepository {
	return {
		async getFreshnessTimestamps() {
			return db.transaction((tx) => {
				// `partial` counts as a successful ingest: at least one source delivered.
				const ingest = tx
					.select({ at: max(jobRuns.finished_at) })
					.from(jobRuns)
					.where(
						and(eq(jobRuns.job_type, 'ingest'), inArray(jobRuns.status, ['succeeded', 'partial']))
					)
					.get();
				const brief = tx
					.select({ at: max(dailyBriefs.published_at) })
					.from(dailyBriefs)
					.where(eq(dailyBriefs.status, 'published'))
					.get();
				return {
					last_ingest_succeeded_at: ingest?.at ?? null,
					last_brief_published_at: brief?.at ?? null
				};
			});
		},

		async hasPublishedDemoContent() {
			const row = db
				.select({ id: events.id })
				.from(events)
				.where(and(isReadableEvent(events), eq(events.is_demo, true)))
				.limit(1)
				.get();
			return row !== undefined;
		},

		async ping() {
			db.$client.prepare('SELECT 1').get();
		},

		async getLatestPublishedBriefDate() {
			const row = db
				.select({ date: max(dailyBriefs.brief_date) })
				.from(dailyBriefs)
				.where(eq(dailyBriefs.status, 'published'))
				.get();
			return row?.date ?? null;
		},

		async getPublishedBrief(date, edition) {
			return db.transaction((tx) => readPublishedBrief(tx, date, edition));
		},

		async listPublishedEditions(date) {
			const rows = db
				.select({ edition: dailyBriefs.edition })
				.from(dailyBriefs)
				.where(and(eq(dailyBriefs.brief_date, date), eq(dailyBriefs.status, 'published')))
				.all();
			const available = new Set(rows.map((row) => row.edition));
			return BRIEF_EDITIONS.filter((edition) => available.has(edition));
		},

		async getAdjacentBriefDates(date) {
			return db.transaction((tx) => {
				const published = eq(dailyBriefs.status, 'published');
				const prev = tx
					.select({ date: max(dailyBriefs.brief_date) })
					.from(dailyBriefs)
					.where(and(published, lt(dailyBriefs.brief_date, date)))
					.get();
				const next = tx
					.select({ date: dailyBriefs.brief_date })
					.from(dailyBriefs)
					.where(and(published, gt(dailyBriefs.brief_date, date)))
					.orderBy(asc(dailyBriefs.brief_date))
					.limit(1)
					.get();
				return { prev: prev?.date ?? null, next: next?.date ?? null };
			});
		},

		async listBriefDatesInMonth(month: YearMonth) {
			const rows = db
				.selectDistinct({ date: dailyBriefs.brief_date })
				.from(dailyBriefs)
				.where(
					and(
						eq(dailyBriefs.status, 'published'),
						gte(dailyBriefs.brief_date, `${month}-01`),
						lte(dailyBriefs.brief_date, `${month}-31`)
					)
				)
				.orderBy(asc(dailyBriefs.brief_date))
				.all();
			return rows.map((row) => row.date);
		},

		async getPublishedEventDetail(id) {
			return db.transaction((tx) => readPublishedEventDetail(tx, id));
		},

		async listPublishedEventsForLesson(lessonId, limit) {
			const rows = db
				.select({ event: events })
				.from(eventLessonLinks)
				.innerJoin(events, eq(events.id, eventLessonLinks.event_id))
				.where(and(eq(eventLessonLinks.lesson_id, lessonId), isReadableEvent(events)))
				.orderBy(desc(events.last_updated_at))
				.limit(limit)
				.all();
			return rows.map((row) => toEventSummary(row.event));
		},

		async listPublishedRelations(options: {
			since: IsoUtc;
			category: CategorySlug | null;
			limit: number;
		}) {
			return db.transaction((tx) =>
				selectPublishedRelations(
					tx,
					gte(eventRelations.created_at, options.since),
					options.category,
					options.limit
				)
			);
		},

		async searchEvents(query) {
			return db.transaction((tx) => searchEvents(tx, query));
		},

		async searchLessons(query) {
			return db.transaction((tx) => searchLessons(tx, query));
		}
	};
}

function readPublishedBrief(
	tx: Executor,
	date: BriefDate,
	edition: BriefEdition | undefined
): BriefView | null {
	const candidates = tx
		.select()
		.from(dailyBriefs)
		.where(and(eq(dailyBriefs.brief_date, date), eq(dailyBriefs.status, 'published')))
		.all();
	const wanted = edition ? [edition] : EDITION_PREFERENCE;
	const brief = wanted
		.map((name) => candidates.find((candidate) => candidate.edition === name))
		.find((candidate) => candidate !== undefined);
	if (!brief || brief.published_at === null) return null;

	const items = tx
		.select({
			event: events,
			rank: dailyBriefEvents.rank,
			selection_reason: dailyBriefEvents.selection_reason
		})
		.from(dailyBriefEvents)
		.innerJoin(events, eq(events.id, dailyBriefEvents.event_id))
		.where(and(eq(dailyBriefEvents.brief_id, brief.id), isReadableEvent(events)))
		.orderBy(asc(dailyBriefEvents.rank))
		.all();

	return {
		id: brief.id,
		brief_date: brief.brief_date,
		edition: brief.edition,
		generated_at: brief.generated_at,
		published_at: brief.published_at,
		events: items.map((item) => ({
			...toEventSummary(item.event),
			rank: item.rank,
			selection_reason: item.selection_reason
		}))
	};
}

function readPublishedEventDetail(tx: Executor, id: string): EventDetail | null {
	const event = tx
		.select()
		.from(events)
		.where(and(eq(events.id, id), isReadableEvent(events)))
		.get();
	if (!event || event.published_at === null) return null;

	const sources = selectEventSources(tx, id);
	const updates = tx
		.select()
		.from(eventUpdates)
		.where(eq(eventUpdates.event_id, id))
		.orderBy(asc(eventUpdates.reported_at))
		.all();
	const urls = loadEvidenceUrls(tx, [
		...event.claims.flatMap((claim) => claim.evidence_refs),
		...updates.flatMap((update) => update.evidence_refs)
	]);

	const lessons = tx
		.select({ lesson: academyLessons })
		.from(eventLessonLinks)
		.innerJoin(academyLessons, eq(academyLessons.id, eventLessonLinks.lesson_id))
		.where(eq(eventLessonLinks.event_id, id))
		.orderBy(asc(academyLessons.day))
		.all();

	const briefAppearances = tx
		.select({ brief_date: dailyBriefs.brief_date, edition: dailyBriefs.edition })
		.from(dailyBriefEvents)
		.innerJoin(dailyBriefs, eq(dailyBriefs.id, dailyBriefEvents.brief_id))
		.where(and(eq(dailyBriefEvents.event_id, id), eq(dailyBriefs.status, 'published')))
		.orderBy(asc(dailyBriefs.brief_date), asc(dailyBriefs.generated_at))
		.all();

	const corrections = tx
		.select({ changed_at: contentRevisions.changed_at, note_th: contentRevisions.public_note_th })
		.from(contentRevisions)
		.where(
			and(
				eq(contentRevisions.entity_type, 'event'),
				eq(contentRevisions.entity_id, id),
				sql`${contentRevisions.public_note_th} IS NOT NULL`
			)
		)
		.orderBy(asc(contentRevisions.changed_at))
		.all();

	const relationWhere = or(
		eq(eventRelations.from_event_id, id),
		eq(eventRelations.to_event_id, id)
	) as SQL;

	return {
		...toEventSummary(event),
		what_happened_th: event.what_happened_th,
		why_it_matters_th: event.why_it_matters_th,
		background_th: event.background_th,
		uncertain_th: event.uncertain_th,
		claims: event.claims.map((claim) => ({
			claimant_th: claim.claimant_th,
			claim_th: claim.claim_th,
			evidence_source_urls: evidenceUrls(claim.evidence_refs, urls)
		})),
		sources,
		updates: updates.map((update) => ({
			id: update.id,
			occurred_at: update.occurred_at,
			reported_at: update.reported_at,
			update_text_th: update.update_text_th,
			evidence_source_urls: evidenceUrls(update.evidence_refs, urls)
		})),
		relations: selectPublishedRelations(tx, relationWhere, null, 50),
		lessons: lessons.map((row) => toLessonSummary(row.lesson)),
		brief_appearances: briefAppearances,
		corrections: corrections.map((row) => ({
			changed_at: row.changed_at,
			note_th: row.note_th ?? ''
		})),
		published_at: event.published_at
	};
}

/** Linked stored articles, oldest first, undated last. The only source of citation URLs. */
export function selectEventSources(tx: Executor, eventId: string): SourceRef[] {
	return tx
		.select({
			article_id: articles.id,
			source_name: articles.publisher_name,
			title: articles.title,
			published_at: articles.published_at,
			url: articles.canonical_url
		})
		.from(eventArticles)
		.innerJoin(articles, eq(articles.id, eventArticles.article_id))
		.where(eq(eventArticles.event_id, eventId))
		.orderBy(sql`${articles.published_at} IS NULL`, asc(articles.published_at), asc(articles.id))
		.all();
}

/**
 * Published relations whose endpoints are both public and with at least one evidence ref that
 * resolves to a stored article (PRD §11 #8 "no link without evidence", BUG-QA-005), newest first.
 * The evidence check is in SQL so that `limit` counts only relations that can be shown.
 */
function selectPublishedRelations(
	tx: Executor,
	where: SQL,
	category: CategorySlug | null,
	limit: number
): RelationView[] {
	const fromEvent = alias(events, 'from_event');
	const toEvent = alias(events, 'to_event');
	const categoryFilter = category
		? or(eq(fromEvent.category, category), eq(toEvent.category, category))
		: undefined;
	const hasResolvableEvidence = sql`EXISTS (SELECT 1 FROM json_each(${eventRelations.evidence_refs}) AS ref INNER JOIN ${articles} ON ${articles.id} = json_extract(ref.value, '$.article_id'))`;

	const rows = tx
		.select({ relation: eventRelations, from: fromEvent, to: toEvent })
		.from(eventRelations)
		.innerJoin(fromEvent, eq(fromEvent.id, eventRelations.from_event_id))
		.innerJoin(toEvent, eq(toEvent.id, eventRelations.to_event_id))
		.where(
			and(
				where,
				eq(eventRelations.status, 'published'),
				isReadableEvent(fromEvent),
				isReadableEvent(toEvent),
				hasResolvableEvidence,
				categoryFilter
			)
		)
		.orderBy(desc(eventRelations.created_at))
		.limit(limit)
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
		reviewed: relation.reviewed_at !== null,
		from_event: toEventSummary(from),
		to_event: toEventSummary(to)
	}));
}
