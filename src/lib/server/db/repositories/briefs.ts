/** `BriefRepository`: brief candidates for a window, and idempotent brief saves. */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, exists, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { BriefStatus } from '../../../types/domain';
import type { BriefRepository } from '../../../types/repositories';
import type { Db } from '../client';
import { articles, dailyBriefEvents, dailyBriefs, eventArticles, events } from '../schema';
import { isPublicEvent, toEventSummary } from './shared';

export function createBriefRepository(db: Db): BriefRepository {
	return {
		async listCandidateEvents(window) {
			const evidenceTime = sql`coalesce(${articles.published_at}, ${articles.ingested_at})`;
			const hasArticleInWindow = exists(
				db
					.select({ one: sql`1` })
					.from(eventArticles)
					.innerJoin(articles, eq(articles.id, eventArticles.article_id))
					.where(
						and(
							eq(eventArticles.event_id, events.id),
							gte(evidenceTime, window.start_utc),
							lt(evidenceTime, window.end_utc)
						)
					)
			);
			// daily_snapshot: the events the day's morning / evening briefs already carried.
			const inBriefsOfDate = window.include_briefs_of
				? exists(
						db
							.select({ one: sql`1` })
							.from(dailyBriefEvents)
							.innerJoin(dailyBriefs, eq(dailyBriefs.id, dailyBriefEvents.brief_id))
							.where(
								and(
									eq(dailyBriefEvents.event_id, events.id),
									eq(dailyBriefs.brief_date, window.include_briefs_of),
									inArray(dailyBriefs.edition, ['morning', 'evening']),
									eq(dailyBriefs.status, 'published')
								)
							)
					)
				: undefined;
			// Continuity (PRD §4.4): an update, or a published relation to an older public event.
			// Outer columns are qualified by hand: Drizzle leaves them bare in single-table selects,
			// which would be ambiguous inside this correlated subquery.
			const eventId = sql`${sql.identifier('events')}.${sql.identifier('id')}`;
			const firstSeenAt = sql`${sql.identifier('events')}.${sql.identifier('first_seen_at')}`;
			const isContinuing = sql<number>`(
				EXISTS (SELECT 1 FROM event_updates u WHERE u.event_id = ${eventId})
				OR EXISTS (
					SELECT 1 FROM event_relations r
					JOIN events other ON other.id = CASE WHEN r.from_event_id = ${eventId} THEN r.to_event_id ELSE r.from_event_id END
					WHERE (r.from_event_id = ${eventId} OR r.to_event_id = ${eventId})
						AND r.status = 'published'
						AND other.status = 'published'
						AND other.first_seen_at < ${firstSeenAt}
				)
			)`;

			const rows = db
				.select({ event: events, is_continuing: isContinuing })
				.from(events)
				.where(and(isPublicEvent(events), or(hasArticleInWindow, inBriefsOfDate)))
				.orderBy(desc(events.last_updated_at), events.id)
				.all();
			return rows.map((row) => ({
				...toEventSummary(row.event),
				signals: row.event.signals,
				is_continuing: Boolean(row.is_continuing)
			}));
		},

		async saveBrief(input) {
			return db.transaction(
				(tx) => {
					const existing = tx
						.select()
						.from(dailyBriefs)
						.where(
							and(
								eq(dailyBriefs.brief_date, input.brief_date),
								eq(dailyBriefs.edition, input.edition)
							)
						)
						.get();

					// An admin-hidden brief stays hidden on regeneration; its items are still refreshed.
					const status: BriefStatus = existing?.status === 'hidden' ? 'hidden' : input.status;
					// First publication time is kept across regenerations; drafts are not published.
					let publishedAt: string | null = null;
					if (status === 'published') publishedAt = existing?.published_at ?? input.generated_at;
					if (status === 'hidden') publishedAt = existing?.published_at ?? null;
					const fields = {
						status,
						generated_at: input.generated_at,
						published_at: publishedAt,
						event_count: input.items.length
					};

					const briefId = existing?.id ?? randomUUID();
					if (existing) {
						tx.update(dailyBriefs).set(fields).where(eq(dailyBriefs.id, briefId)).run();
					} else {
						tx.insert(dailyBriefs)
							.values({
								id: briefId,
								brief_date: input.brief_date,
								edition: input.edition,
								...fields
							})
							.run();
					}

					tx.delete(dailyBriefEvents).where(eq(dailyBriefEvents.brief_id, briefId)).run();
					if (input.items.length > 0) {
						tx.insert(dailyBriefEvents)
							.values(input.items.map((item) => ({ ...item, brief_id: briefId })))
							.run();
					}
					return briefId;
				},
				{ behavior: 'immediate' }
			);
		}
	};
}
