import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventContentWrite } from '../../../types/repositories';
import type { Db } from '../client';
import { contentRevisions, eventRelations, events } from '../schema';
import { openTestDb } from '../test-db';
import { createRepositories } from './index';

let db: Db;
let repos: ReturnType<typeof createRepositories>;
let counter = 0;

beforeEach(async () => {
	db = openTestDb();
	repos = createRepositories(db);
	await repos.ingest.syncSources([
		{
			id: 'wire-a',
			name: 'Wire A',
			kind: 'fixture',
			homepage_url: 'https://example.com/a',
			feed_url: 'a.xml',
			license_notes: '',
			allow_excerpt: false,
			is_demo: false,
			enabled: true
		},
		{
			id: 'demo-wire',
			name: 'Demo Wire',
			kind: 'fixture',
			homepage_url: 'https://example.com/demo',
			feed_url: 'demo.xml',
			license_notes: '',
			allow_excerpt: false,
			is_demo: true,
			enabled: true
		}
	]);
});
afterEach(() => db.$client.close());

async function addArticle(
	publishedAt: string | null,
	options: { source?: string; publisher?: string; ingestedAt?: string } = {}
): Promise<string> {
	counter += 1;
	const result = await repos.ingest.insertArticleIfNew({
		source_id: options.source ?? 'wire-a',
		source_url: `https://example.com/a/${counter}`,
		canonical_url: `https://example.com/a/${counter}`,
		publisher_name: options.publisher ?? 'Wire A',
		title: `Story ${counter}`,
		excerpt: null,
		language: 'en',
		published_at: publishedAt,
		ingested_at: options.ingestedAt ?? '2026-11-13T01:00:00.000Z',
		content_hash: `hash-${counter}`,
		raw_metadata: {}
	});
	return result.article_id;
}

const content = (overrides: Partial<EventContentWrite> = {}): EventContentWrite => ({
	title_th: 'หัวข้อข่าว',
	summary_th: 'สรุปข่าว',
	what_happened_th: 'เกิดอะไรขึ้น',
	why_it_matters_th: 'ทำไมสำคัญ',
	background_th: null,
	uncertain_th: null,
	claims: [],
	category: 'economy',
	regions: ['global'],
	countries: [],
	tags: ['inflation'],
	signals: { impact_breadth: 2, thailand_relevance: 2, sensitive: false },
	occurred_at: null,
	summarized_at: '2026-11-13T02:00:00.000Z',
	status: 'published',
	review_reasons: [],
	new_updates: [],
	...overrides
});

const getEvent = (id: string) => db.select().from(events).where(eq(events.id, id)).get()!;

describe('event_date is the Asia/Bangkok date of first_seen_at', () => {
	it('keeps 16:59:59.999Z on the previous Bangkok day', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-12T16:59:59.999Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		expect(getEvent(id)).toMatchObject({
			status: 'draft',
			first_seen_at: '2026-11-12T16:59:59.999Z',
			event_date: '2026-11-12'
		});
	});

	it('moves 17:00:00.000Z (00:00 ICT) to the next Bangkok day', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-12T17:00:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		expect(getEvent(id).event_date).toBe('2026-11-13');
	});

	it('falls back to ingested_at when the feed has no timestamp, and re-derives on link', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle(null, { ingestedAt: '2026-11-13T03:00:00.000Z' })],
			1,
			'2026-11-13T03:00:00.000Z'
		);
		expect(getEvent(id)).toMatchObject({
			first_seen_at: '2026-11-13T03:00:00.000Z',
			source_count: 1
		});

		const earlier = await addArticle('2026-11-12T16:30:00.000Z', {
			source: 'demo-wire',
			publisher: 'Demo Wire'
		});
		await repos.digest.linkArticles(id, [earlier], 0.8, '2026-11-13T04:00:00.000Z');

		expect(getEvent(id)).toMatchObject({
			first_seen_at: '2026-11-12T16:30:00.000Z',
			event_date: '2026-11-12',
			last_updated_at: '2026-11-13T03:00:00.000Z',
			source_count: 2,
			is_demo: true,
			updated_at: '2026-11-13T04:00:00.000Z'
		});
	});
});

describe('DigestRepository linking', () => {
	it('links an article to at most one event; relinking is a no-op', async () => {
		const articleId = await addArticle('2026-11-13T00:00:00.000Z');
		const first = await repos.digest.createDraftEvent([articleId], 1, '2026-11-13T01:00:00.000Z');
		const other = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:10:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);

		await repos.digest.linkArticles(other, [articleId], 0.5, '2026-11-13T02:00:00.000Z');
		await repos.digest.linkArticles(first, [articleId], 0.5, '2026-11-13T02:00:00.000Z');

		const [match] = (await repos.digest.listMatchableEvents('2026-11-12T00:00:00.000Z')).filter(
			(candidate) => candidate.event_id === first
		);
		expect(match?.article_titles).toHaveLength(1);
		await expect(
			repos.digest.createDraftEvent([articleId], 1, '2026-11-13T02:00:00.000Z')
		).rejects.toThrow(/already linked/);
		expect(await repos.digest.listUnassignedArticles('2026-11-12T00:00:00.000Z', 10)).toEqual([]);
	});

	it('lists matchable events newest first with the id as a deterministic tie-break', async () => {
		const sameTime = '2026-11-13T00:00:00.000Z';
		const ids = [];
		for (let index = 0; index < 3; index++) {
			ids.push(await repos.digest.createDraftEvent([await addArticle(sameTime)], 1, sameTime));
		}

		const listed = await repos.digest.listMatchableEvents('2026-11-12T00:00:00.000Z');
		expect(listed.map((candidate) => candidate.event_id)).toEqual([...ids].sort());
		expect(listed.every((candidate) => candidate.is_demo === false)).toBe(true);
	});
});

describe('DigestRepository content lifecycle', () => {
	it('publishes drafts, lists events needing content, and audits re-summaries of published events', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		expect((await repos.digest.listEventsNeedingContent(10)).map((e) => e.event.id)).toEqual([id]);

		await repos.digest.saveEventContent(id, content(), '2026-11-13T02:00:00.000Z');
		expect(getEvent(id)).toMatchObject({
			status: 'published',
			published_at: '2026-11-13T02:00:00.000Z'
		});
		expect(await repos.digest.listEventsNeedingContent(10)).toEqual([]);

		// A new article after summarized_at makes it stale again.
		await repos.digest.linkArticles(
			id,
			[await addArticle('2026-11-13T02:30:00.000Z')],
			0.9,
			'2026-11-13T03:00:00.000Z'
		);
		expect((await repos.digest.listEventsNeedingContent(10)).map((e) => e.event.id)).toEqual([id]);

		await repos.digest.saveEventContent(
			id,
			content({
				title_th: 'หัวข้อใหม่',
				summarized_at: '2026-11-13T03:05:00.000Z',
				new_updates: [
					{
						occurred_at: null,
						reported_at: '2026-11-13T02:30:00.000Z',
						update_text_th: 'มีพัฒนาการใหม่',
						evidence_refs: []
					}
				]
			}),
			'2026-11-13T03:05:00.000Z'
		);
		const revisions = db.select().from(contentRevisions).all();
		expect(revisions).toHaveLength(1);
		expect(revisions[0]).toMatchObject({ changed_by: 'system', entity_id: id });
		expect(revisions[0]?.before_after.before).toMatchObject({ title_th: 'หัวข้อข่าว' });
		// First publication time is kept.
		expect(getEvent(id).published_at).toBe('2026-11-13T02:00:00.000Z');
	});

	it('never demotes a published event', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		await repos.digest.saveEventContent(id, content(), '2026-11-13T02:00:00.000Z');

		await repos.digest.markEventForReview(id, ['llm_failed'], '2026-11-13T03:00:00.000Z');
		expect(getEvent(id).status).toBe('published');
		await expect(
			repos.digest.saveEventContent(
				id,
				content({ status: 'pending_review', review_reasons: ['llm_failed'] }),
				'2026-11-13T03:00:00.000Z'
			)
		).rejects.toThrow(/cannot be demoted/);
	});

	it('retries pending events only when the sole reason is llm_failed', async () => {
		const retry = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		const manual = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:05:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		await repos.digest.markEventForReview(retry, ['llm_failed'], '2026-11-13T01:10:00.000Z');
		await repos.digest.markEventForReview(
			manual,
			['llm_failed', 'no_source'],
			'2026-11-13T01:10:00.000Z'
		);

		const ids = (await repos.digest.listEventsNeedingContent(10)).map((e) => e.event.id);
		expect(ids).toEqual([retry]);
	});
});

describe('DigestRepository relations and lesson links', () => {
	async function publishedEvent(publishedAt: string, tags: string[]): Promise<string> {
		const id = await repos.digest.createDraftEvent(
			[await addArticle(publishedAt)],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		await repos.digest.saveEventContent(id, content({ tags }), '2026-11-13T02:00:00.000Z');
		return id;
	}

	it('upserts on (from, to, type), normalizes same_topic order, and keeps admin decisions', async () => {
		const a = await publishedEvent('2026-11-13T00:00:00.000Z', ['oil']);
		const b = await publishedEvent('2026-11-13T00:10:00.000Z', ['oil']);
		const [low, high] = [a, b].sort();
		const relation = {
			from_event_id: high!,
			to_event_id: low!,
			relation_type: 'same_topic' as const,
			explanation_th: 'เรื่องเดียวกัน',
			evidence_refs: [],
			status: 'pending_review' as const,
			confidence: 0.5
		};

		await repos.digest.upsertRelation(relation);
		await repos.digest.upsertRelation({ ...relation, confidence: 0.7, status: 'published' });
		let rows = db.select().from(eventRelations).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ from_event_id: low, to_event_id: high, confidence: 0.7 });

		await repos.admin.setRelationStatus(
			rows[0]!.id,
			'rejected',
			{ changed_by: 'admin@example.com', change_reason: 'not related', public_note_th: null },
			'2026-11-13T05:00:00.000Z'
		);
		await repos.digest.upsertRelation({ ...relation, status: 'published', confidence: 0.9 });
		rows = db.select().from(eventRelations).all();
		expect(rows[0]).toMatchObject({ status: 'rejected', reviewed_by: 'admin@example.com' });
	});

	it('lists published candidates sharing a tag or category', async () => {
		const source = await publishedEvent('2026-11-13T00:00:00.000Z', ['oil']);
		const sharing = await publishedEvent('2026-11-13T00:10:00.000Z', ['oil']);
		const candidates = await repos.digest.listRelationCandidates(
			source,
			'2026-11-01T00:00:00.000Z',
			8
		);
		expect(candidates.map((candidate) => candidate.event.id)).toEqual([sharing]);
		expect(candidates[0]?.articles).toHaveLength(1);
	});

	it('replaces lesson links for an event', async () => {
		await repos.academy.replaceLessonCatalog([
			{
				id: 'w2-d09',
				week: 2,
				day: 9,
				slug: 'inflation',
				title: 'เงินเฟ้อ',
				summary: 'สรุป',
				content_path: 'x.md',
				tags: [],
				categories: ['economy'],
				search_text: ''
			}
		]);
		const id = await publishedEvent('2026-11-13T00:00:00.000Z', ['inflation']);

		await repos.digest.replaceLessonLinks(id, [
			{ event_id: id, lesson_id: 'w2-d09', rationale_th: 'เกี่ยวกับเงินเฟ้อ', evidence_refs: [] }
		]);
		await repos.digest.replaceLessonLinks(id, [
			{ event_id: id, lesson_id: 'w2-d09', rationale_th: 'ปรับเหตุผล', evidence_refs: [] }
		]);
		expect(await repos.read.listPublishedEventsForLesson('w2-d09', 5)).toHaveLength(1);

		await repos.digest.replaceLessonLinks(id, []);
		expect(await repos.read.listPublishedEventsForLesson('w2-d09', 5)).toEqual([]);
	});
});
