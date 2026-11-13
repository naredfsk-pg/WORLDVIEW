/**
 * PRD §11 #7 (citations) and #8 (relations), checked at the public read layer over the whole
 * seeded demo database: every public event has at least one source, every link a reader can see
 * comes from the stored `articles` rows (never from LLM text), and every public relation has a
 * type, an explanation and resolvable evidence.
 *
 * The last block corrupts rows on purpose: it asks whether the read layer itself refuses
 * evidence-less content, or only trusts the write-side gates (see docs/qa/BUGS.md).
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLessonFiles, toAcademyLessonRows } from '../../../content/academy.server';
import { CAUSAL_RELATION_TYPES, RELATION_TYPES } from '../../../types/domain';
import type { EventDetail } from '../../../types/views';
import type { Db } from '../client';
import { articles, eventArticles, eventRelations, events } from '../schema';
import { seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { createRepositories } from './index';

const LESSON_ROWS = toAcademyLessonRows(readLessonFiles().lessons);

let db: Db;
let read: ReturnType<typeof createRepositories>['read'];

beforeEach(() => {
	db = openTestDb();
	seedDatabase(db, LESSON_ROWS);
	read = createRepositories(db).read;
});
afterEach(() => db.$client.close());

describe('acceptance #7: every public event cites stored sources', () => {
	it('each published event has >= 1 source, and every visible URL is a stored article URL', async () => {
		const storedUrls = new Set(
			db
				.select({ url: articles.canonical_url })
				.from(articles)
				.all()
				.map((row) => row.url)
		);
		const published = publishedEventIds();
		expect(published.length).toBeGreaterThan(0);

		for (const id of published) {
			const detail = await read.getPublishedEventDetail(id);
			expect(detail, id).not.toBeNull();
			expect(detail!.sources.length, `${id} sources`).toBeGreaterThanOrEqual(1);
			for (const url of visibleUrls(detail!)) {
				expect(storedUrls.has(url), `${id}: ${url}`).toBe(true);
			}
		}
	});

	it('a source URL is the article row of that event, not any stored URL', async () => {
		for (const id of publishedEventIds()) {
			const linked = new Set(
				db
					.select({ url: articles.canonical_url })
					.from(eventArticles)
					.innerJoin(articles, eq(articles.id, eventArticles.article_id))
					.where(eq(eventArticles.event_id, id))
					.all()
					.map((row) => row.url)
			);
			const detail = await read.getPublishedEventDetail(id);
			expect(detail!.sources.map((source) => source.url).sort(), id).toEqual([...linked].sort());
		}
	});

	it('an URL written into the event text by an LLM is never turned into a link', async () => {
		const invented = 'https://invented.example.com/fake-report';
		db.update(events)
			.set({ why_it_matters_th: `อ่านต่อที่ ${invented}` })
			.where(eq(events.id, 'demo-evt-01'))
			.run();

		const detail = await read.getPublishedEventDetail('demo-evt-01');
		expect(visibleUrls(detail!)).not.toContain(invented);
	});

	it('draft, pending_review and hidden events are not public', async () => {
		for (const status of ['draft', 'pending_review', 'hidden'] as const) {
			db.update(events).set({ status }).where(eq(events.id, 'demo-evt-02')).run();
			expect(await read.getPublishedEventDetail('demo-evt-02'), status).toBeNull();
		}
	});
});

describe('acceptance #8: public relations carry a type, an explanation and evidence', () => {
	it('every published relation shown publicly has all three; causal ones have evidence', async () => {
		const relations = await read.listPublishedRelations({
			since: '1970-01-01T00:00:00.000Z',
			category: null,
			limit: 500
		});
		expect(relations.length).toBeGreaterThan(0);
		for (const relation of relations) {
			expect(RELATION_TYPES, relation.id).toContain(relation.relation_type);
			expect(relation.explanation_th.trim().length, relation.id).toBeGreaterThan(0);
			expect(relation.evidence_source_urls.length, relation.id).toBeGreaterThanOrEqual(1);
		}
		const causal = relations.filter((relation) =>
			(CAUSAL_RELATION_TYPES as readonly string[]).includes(relation.relation_type)
		);
		expect(causal.every((relation) => relation.evidence_source_urls.length > 0)).toBe(true);
	});

	it('pending_review and rejected relations are never public', async () => {
		db.update(eventRelations).set({ status: 'pending_review' }).run();
		expect(
			await read.listPublishedRelations({
				since: '1970-01-01T00:00:00.000Z',
				category: null,
				limit: 500
			})
		).toEqual([]);
	});
});

describe('defence in depth: the read layer with rows that bypassed the gates', () => {
	// BUG-QA-005: a published relation whose evidence does not resolve to a stored article is not
	// shown, neither on /connections nor on the event page.
	it('BUG-QA-005: a published causal relation whose evidence does not resolve is not shown (repro: evidenceWithoutArticle)', async () => {
		const relations = await evidenceWithoutArticle();
		expect(relations.find((relation) => relation.id === BROKEN_RELATION_ID)).toBeUndefined();

		const [from] = publishedEventIds();
		const detail = await read.getPublishedEventDetail(from!);
		expect(detail!.relations.map((relation) => relation.id)).not.toContain(BROKEN_RELATION_ID);
	});

	it('BUG-QA-005: a relation with one resolvable and one missing ref is still shown', async () => {
		db.update(eventRelations)
			.set({
				evidence_refs: [{ article_id: 'qa-missing-article' }, { article_id: 'demo-art-02a' }]
			})
			.where(eq(eventRelations.to_event_id, 'demo-evt-02'))
			.run();
		const relations = await read.listPublishedRelations({
			since: '1970-01-01T00:00:00.000Z',
			category: null,
			limit: 500
		});
		const kept = relations.filter((relation) => relation.to_event_id === 'demo-evt-02');
		expect(kept.length).toBeGreaterThan(0);
		for (const relation of kept) expect(relation.evidence_source_urls).toHaveLength(1);
	});

	// BUG-QA-006: a published event with no linked article is not public anywhere (PRD §1.4:
	// every published event has >= 1 verifiable source).
	it('BUG-QA-006: a published event with no linked article is not public', async () => {
		const sourceless = 'demo-evt-02';
		const [row] = db
			.select({ title: events.title_th })
			.from(events)
			.where(eq(events.id, sourceless))
			.all();
		const searchIds = async () =>
			(
				await read.searchEvents({
					q: row!.title,
					scope: 'all',
					category: null,
					region: null,
					from: null,
					to: null,
					limit: 50,
					offset: 0
				})
			).items.map((event) => event.id);
		expect(await searchIds()).toContain(sourceless);

		db.delete(eventArticles).where(eq(eventArticles.event_id, sourceless)).run();

		expect(await read.getPublishedEventDetail(sourceless)).toBeNull();

		const brief = await read.getPublishedBrief('2026-11-13', 'morning');
		expect(brief!.events.length).toBeGreaterThan(0);
		expect(brief!.events.map((event) => event.id)).not.toContain(sourceless);

		expect(await searchIds()).not.toContain(sourceless);

		const relations = await read.listPublishedRelations({
			since: '1970-01-01T00:00:00.000Z',
			category: null,
			limit: 500
		});
		const endpoints = relations.flatMap((relation) => [
			relation.from_event_id,
			relation.to_event_id
		]);
		expect(endpoints).not.toContain(sourceless);
	});
});

const BROKEN_RELATION_ID = 'qa-broken-relation';

/** A published `response_to` relation whose only evidence ref points at a missing article. */
async function evidenceWithoutArticle() {
	const [from, to] = publishedEventIds();
	db.insert(eventRelations)
		.values({
			id: BROKEN_RELATION_ID,
			from_event_id: from!,
			to_event_id: to!,
			relation_type: 'response_to',
			explanation_th: 'เชื่อมโยงโดยไม่มีหลักฐานที่ตรวจสอบได้',
			evidence_refs: [{ article_id: 'qa-missing-article' }],
			status: 'published',
			confidence: 0.9,
			created_at: '2026-11-13T00:00:00.000Z',
			reviewed_at: null,
			reviewed_by: null
		})
		.run();
	return read.listPublishedRelations({
		since: '1970-01-01T00:00:00.000Z',
		category: null,
		limit: 500
	});
}

function publishedEventIds(): string[] {
	return db
		.select({ id: events.id })
		.from(events)
		.where(sql`${events.status} = 'published' AND ${events.category} IS NOT NULL`)
		.all()
		.map((row) => row.id);
}

/** Every URL the event page turns into a link: sources, claim, update and relation evidence. */
function visibleUrls(detail: EventDetail): string[] {
	return [
		...detail.sources.map((source) => source.url),
		...detail.claims.flatMap((claim) => claim.evidence_source_urls),
		...detail.updates.flatMap((update) => update.evidence_source_urls),
		...detail.relations.flatMap((relation) => relation.evidence_source_urls)
	];
}
