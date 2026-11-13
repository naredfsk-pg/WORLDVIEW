/**
 * Development seed: the Academy catalog from `content/academy/**` plus the fictional demo news
 * fixtures. Idempotent: rows are keyed by fixed ids, written only when missing or different, and
 * the report counts inserted / updated / unchanged rows per table (a rerun reports 0 changes).
 */
import { createHash } from 'node:crypto';
import { and, eq, getTableColumns, getTableName, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { AcademyLessonRow } from '../../types/domain';
import type { Db } from './client';
import {
	DEMO_BRIEFS,
	DEMO_EVENTS,
	DEMO_RELATIONS,
	DEMO_REVISIONS,
	DEMO_SOURCES,
	DEMO_URL_BASE
} from './fixtures/demo';
import { deriveEventFacts } from './repositories/digest';
import type { Executor } from './repositories/shared';
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
	jobRuns,
	llmCalls,
	sources
} from './schema';

export interface TableChanges {
	inserted: number;
	updated: number;
	unchanged: number;
}

export interface SeedReport {
	changes: Record<string, TableChanges>;
	warnings: string[];
}

const ALL_TABLES = [
	sources,
	articles,
	events,
	eventArticles,
	eventUpdates,
	eventRelations,
	academyLessons,
	eventLessonLinks,
	dailyBriefs,
	dailyBriefEvents,
	jobRuns,
	llmCalls,
	contentRevisions
];
const FTS_TABLES = ['events_fts', 'lessons_fts'];

/** `lessonRows` come from `#lib/content` (the caller reads the files; `db` does not import `content`). */
export function seedDatabase(db: Db, lessonRows: AcademyLessonRow[]): SeedReport {
	const demo = buildDemoRows(new Set(lessonRows.map((row) => row.id)));

	// One transaction, parents before children (FK order).
	const changes = db.transaction((tx) => ({
		sources: upsertRows(tx, sources, ['id'], demo.sources),
		academy_lessons: upsertRows(tx, academyLessons, ['id'], lessonRows),
		articles: upsertRows(tx, articles, ['id'], demo.articles),
		events: upsertRows(tx, events, ['id'], demo.events),
		event_articles: upsertRows(tx, eventArticles, ['event_id', 'article_id'], demo.eventArticles),
		event_updates: upsertRows(tx, eventUpdates, ['id'], demo.eventUpdates),
		event_relations: upsertRows(tx, eventRelations, ['id'], demo.eventRelations),
		event_lesson_links: upsertRows(
			tx,
			eventLessonLinks,
			['event_id', 'lesson_id'],
			demo.eventLessonLinks
		),
		daily_briefs: upsertRows(tx, dailyBriefs, ['id'], demo.dailyBriefs),
		daily_brief_events: upsertRows(
			tx,
			dailyBriefEvents,
			['brief_id', 'event_id'],
			demo.dailyBriefEvents
		),
		content_revisions: upsertRows(tx, contentRevisions, ['id'], demo.contentRevisions)
	}));

	return { changes, warnings: demo.warnings };
}

export function countRows(db: Db): Record<string, number> {
	const names = [...ALL_TABLES.map((table) => getTableName(table)), ...FTS_TABLES];
	return Object.fromEntries(
		names.map((name) => {
			const row = db.get<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(name)}`);
			return [name, row.n];
		})
	);
}

/** Turns the typed fixtures into table rows, deriving event facts exactly like the digest repository. */
function buildDemoRows(lessonIds: Set<string>) {
	const warnings: string[] = [];
	const sourceById = new Map(DEMO_SOURCES.map((source) => [source.id, source]));
	const refs = (ids: string[]) => ids.map((article_id) => ({ article_id }));

	// Columns only: `link_hosts` is registry-only.
	const sourceRows: (typeof sources.$inferInsert)[] = DEMO_SOURCES.map((source) => ({
		id: source.id,
		name: source.name,
		kind: source.kind,
		homepage_url: source.homepage_url,
		feed_url: source.feed_url,
		license_notes: source.license_notes,
		allow_excerpt: source.allow_excerpt,
		is_demo: source.is_demo,
		enabled: source.enabled,
		last_success_at: null,
		last_error_at: null,
		last_error: null
	}));

	const articleRows: (typeof articles.$inferInsert)[] = [];
	const eventRows: (typeof events.$inferInsert)[] = [];
	const eventArticleRows: (typeof eventArticles.$inferInsert)[] = [];
	const updateRows: (typeof eventUpdates.$inferInsert)[] = [];
	const lessonLinkRows: (typeof eventLessonLinks.$inferInsert)[] = [];

	for (const event of DEMO_EVENTS) {
		const eventArticlesFull = event.articles.map((article) => {
			const source = sourceById.get(article.source_id);
			if (!source) throw new Error(`demo fixture: unknown source ${article.source_id}`);
			const url = `${DEMO_URL_BASE}/${source.id}/${article.id}`;
			const ingestedAt = addMinutes(article.published_at ?? event.articles[0]!.published_at!, 5);
			return {
				id: article.id,
				source_id: source.id,
				source_url: url,
				canonical_url: url,
				publisher_name: source.name,
				title: article.title,
				excerpt: null,
				language: 'th',
				published_at: article.published_at,
				ingested_at: ingestedAt,
				// Stable placeholder fingerprint; real ingest uses the news module's normalized hash.
				content_hash: sha256(`${article.title}\npublisher:${source.name}`),
				raw_metadata: { guid: article.id },
				taxonomy: {
					category: event.category,
					regions: event.regions,
					countries: event.countries,
					tags: event.tags
				}
			};
		});
		articleRows.push(...eventArticlesFull);

		const facts = deriveEventFacts(
			eventArticlesFull.map((article) => ({ ...article, is_demo: true })),
			event.updates.map((update) => update.reported_at)
		);
		const lastIngestedAt = eventArticlesFull
			.map((article) => article.ingested_at)
			.sort()
			.at(-1)!;
		const summarizedAt = addMinutes(lastIngestedAt, 15);
		const publishedAt = event.status === 'published' ? summarizedAt : null;

		eventRows.push({
			id: event.id,
			status: event.status,
			review_reasons: event.review_reasons,
			title_th: event.title_th,
			summary_th: event.summary_th,
			what_happened_th: event.what_happened_th,
			why_it_matters_th: event.why_it_matters_th,
			background_th: event.background_th,
			uncertain_th: event.uncertain_th,
			claims: event.claims.map((claim) => ({
				claimant_th: claim.claimant_th,
				claim_th: claim.claim_th,
				evidence_refs: refs(claim.article_ids)
			})),
			category: event.category,
			regions: event.regions,
			countries: event.countries,
			tags: event.tags,
			signals: event.signals,
			occurred_at: event.occurred_at,
			...facts,
			published_at: publishedAt,
			summarized_at: summarizedAt,
			created_at: eventArticlesFull[0]!.ingested_at,
			updated_at: [summarizedAt, facts.last_updated_at].sort().at(-1)!
		});

		eventArticleRows.push(
			...eventArticlesFull.map((article) => ({
				event_id: event.id,
				article_id: article.id,
				relation_confidence: 0.9,
				linked_at: article.ingested_at
			}))
		);
		updateRows.push(
			...event.updates.map((update) => ({
				id: update.id,
				event_id: event.id,
				occurred_at: null,
				reported_at: update.reported_at,
				update_text_th: update.update_text_th,
				evidence_refs: refs(update.article_ids),
				created_at: update.reported_at
			}))
		);

		for (const link of event.lessons) {
			if (!lessonIds.has(link.lesson_id)) {
				warnings.push(
					`lesson link ${event.id} → ${link.lesson_id} skipped: lesson not in catalog yet`
				);
				continue;
			}
			lessonLinkRows.push({
				event_id: event.id,
				lesson_id: link.lesson_id,
				rationale_th: link.rationale_th,
				evidence_refs: [],
				created_at: summarizedAt
			});
		}
	}

	const relationRows: (typeof eventRelations.$inferInsert)[] = DEMO_RELATIONS.map(
		({ evidence_article_ids, ...relation }) => ({
			...relation,
			evidence_refs: refs(evidence_article_ids)
		})
	);
	const briefRows: (typeof dailyBriefs.$inferInsert)[] = DEMO_BRIEFS.map((brief) => ({
		id: brief.id,
		brief_date: brief.brief_date,
		edition: brief.edition,
		status: 'published',
		generated_at: brief.published_at,
		published_at: brief.published_at,
		event_count: brief.items.length
	}));
	const briefEventRows: (typeof dailyBriefEvents.$inferInsert)[] = DEMO_BRIEFS.flatMap((brief) =>
		brief.items.map((item, index) => ({
			brief_id: brief.id,
			event_id: item.event_id,
			rank: index + 1,
			selection_reason: item.selection_reason
		}))
	);

	return {
		warnings,
		sources: sourceRows,
		articles: articleRows,
		events: eventRows,
		eventArticles: eventArticleRows,
		eventUpdates: updateRows,
		eventRelations: relationRows,
		eventLessonLinks: lessonLinkRows,
		dailyBriefs: briefRows,
		dailyBriefEvents: briefEventRows,
		contentRevisions: DEMO_REVISIONS as (typeof contentRevisions.$inferInsert)[]
	};
}

/** Insert missing rows, update rows whose stored values differ, leave identical rows alone. */
function upsertRows<TTable extends SQLiteTable>(
	tx: Executor,
	table: TTable,
	keyColumns: string[],
	rows: TTable['$inferInsert'][]
): TableChanges {
	const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
	const counts: TableChanges = { inserted: 0, updated: 0, unchanged: 0 };

	for (const row of rows) {
		const values = row as Record<string, unknown>;
		const where = and(...keyColumns.map((key) => eq(columns[key]!, values[key])));
		const existing = tx
			.select()
			.from(table as SQLiteTable)
			.where(where)
			.get() as Record<string, unknown> | undefined;

		if (!existing) {
			tx.insert(table).values(row).run();
			counts.inserted += 1;
			continue;
		}
		const differs = Object.keys(values).some(
			(key) => JSON.stringify(existing[key] ?? null) !== JSON.stringify(values[key] ?? null)
		);
		if (!differs) {
			counts.unchanged += 1;
			continue;
		}
		tx.update(table).set(row).where(where).run();
		counts.updated += 1;
	}
	return counts;
}

function addMinutes(isoUtc: string, minutes: number): string {
	return new Date(Date.parse(isoUtc) + minutes * 60_000).toISOString();
}

function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}
