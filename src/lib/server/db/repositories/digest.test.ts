import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReviewReason } from '../../../types/domain';
import type { EventContentWrite } from '../../../types/repositories';
import type { Db } from '../client';
import { contentRevisions, eventRelations, events, eventUpdates } from '../schema';
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
			id: 'wire-b',
			name: 'Wire B',
			kind: 'fixture',
			homepage_url: 'https://example.com/b',
			feed_url: 'b.xml',
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

const content = (
	overrides: Partial<EventContentWrite> = {}
): Omit<EventContentWrite, 'listed'> => ({
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

/** Retry backoff never holds an event back in these tests unless a test passes its own instant. */
const RETRY_ANY = '9999-12-31T00:00:00.000Z';

/** saveEventContent as digest calls it: `listed` is the row as stored now (no change meanwhile). */
function saveAsListed(
	id: string,
	write: Omit<EventContentWrite, 'listed'> & Partial<Pick<EventContentWrite, 'listed'>>,
	now: string
) {
	const row = getEvent(id);
	return repos.digest.saveEventContent(
		id,
		{ listed: { updated_at: row.updated_at, status: row.status }, ...write },
		now
	);
}

function markAsListed(id: string, reasons: ReviewReason[], now: string) {
	const row = getEvent(id);
	return repos.digest.markEventForReview(
		id,
		reasons,
		{ updated_at: row.updated_at, status: row.status },
		now
	);
}

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
		expect(
			(await repos.digest.listEventsNeedingContent(10, RETRY_ANY)).map((e) => e.event.id)
		).toEqual([id]);

		await saveAsListed(id, content(), '2026-11-13T02:00:00.000Z');
		expect(getEvent(id)).toMatchObject({
			status: 'published',
			published_at: '2026-11-13T02:00:00.000Z'
		});
		expect(await repos.digest.listEventsNeedingContent(10, RETRY_ANY)).toEqual([]);

		// A new article after summarized_at makes it stale again.
		await repos.digest.linkArticles(
			id,
			[await addArticle('2026-11-13T02:30:00.000Z')],
			0.9,
			'2026-11-13T03:00:00.000Z'
		);
		expect(
			(await repos.digest.listEventsNeedingContent(10, RETRY_ANY)).map((e) => e.event.id)
		).toEqual([id]);

		await saveAsListed(
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

	it('lists the articles linked since the last summary, and never stores the same update twice', async () => {
		const first = await addArticle('2026-11-13T00:00:00.000Z');
		const id = await repos.digest.createDraftEvent([first], 1, '2026-11-13T01:00:00.000Z');
		const [draft] = await repos.digest.listEventsNeedingContent(10, RETRY_ANY);
		// Never summarized: every linked article is new.
		expect(draft?.new_article_ids).toEqual([first]);
		await saveAsListed(id, content(), '2026-11-13T02:00:00.000Z');

		const later = await addArticle('2026-11-13T02:30:00.000Z');
		await repos.digest.linkArticles(id, [later], 0.9, '2026-11-13T03:00:00.000Z');
		const [stale] = await repos.digest.listEventsNeedingContent(10, RETRY_ANY);
		expect(stale?.new_article_ids).toEqual([later]);

		const update = {
			occurred_at: null,
			reported_at: '2026-11-13T02:30:00.000Z',
			update_text_th: 'มีพัฒนาการใหม่',
			evidence_refs: [{ article_id: later }]
		};
		const resummary = content({ summarized_at: '2026-11-13T03:05:00.000Z', new_updates: [update] });
		await saveAsListed(id, resummary, '2026-11-13T03:05:00.000Z');
		// A forced rerun with the same evidence set (and a duplicate in one list) adds nothing.
		await saveAsListed(
			id,
			{ ...resummary, new_updates: [update, { ...update, update_text_th: 'ข้อความอื่น' }] },
			'2026-11-13T03:10:00.000Z'
		);

		const stored = db.select().from(eventUpdates).where(eq(eventUpdates.event_id, id)).all();
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			update_text_th: 'มีพัฒนาการใหม่',
			reported_at: '2026-11-13T02:30:00.000Z',
			occurred_at: null,
			evidence_refs: [{ article_id: later }]
		});
	});

	it('never lets a new update report earlier than the latest stored one', async () => {
		const first = await addArticle('2026-11-13T00:00:00.000Z');
		const id = await repos.digest.createDraftEvent([first], 1, '2026-11-13T01:00:00.000Z');
		await saveAsListed(id, content(), '2026-11-13T02:00:00.000Z');
		const update = (articleId: string, reportedAt: string) => ({
			occurred_at: null,
			reported_at: reportedAt,
			update_text_th: 'มีพัฒนาการใหม่',
			evidence_refs: [{ article_id: articleId }]
		});
		const later = await addArticle('2026-11-13T05:00:00.000Z');
		const older = await addArticle('2026-11-12T22:00:00.000Z');
		await repos.digest.linkArticles(id, [later, older], 1, '2026-11-13T05:10:00.000Z');

		await saveAsListed(
			id,
			content({ new_updates: [update(later, '2026-11-13T05:00:00.000Z')] }),
			'2026-11-13T05:20:00.000Z'
		);
		// A late-linked older article: its update is placed at the latest time, not before it.
		await saveAsListed(
			id,
			content({ new_updates: [update(older, '2026-11-12T22:00:00.000Z')] }),
			'2026-11-13T05:30:00.000Z'
		);

		const reported = db
			.select()
			.from(eventUpdates)
			.where(eq(eventUpdates.event_id, id))
			.all()
			.map((row) => row.reported_at)
			.sort();
		expect(reported).toEqual(['2026-11-13T05:00:00.000Z', '2026-11-13T05:00:00.000Z']);
	});

	it('never demotes a published event', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			'2026-11-13T01:00:00.000Z'
		);
		await saveAsListed(id, content(), '2026-11-13T02:00:00.000Z');

		await markAsListed(id, ['llm_failed'], '2026-11-13T03:00:00.000Z');
		expect(getEvent(id).status).toBe('published');
		await expect(
			saveAsListed(
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
		await markAsListed(retry, ['llm_failed'], '2026-11-13T01:10:00.000Z');
		await markAsListed(manual, ['llm_failed', 'no_source'], '2026-11-13T01:10:00.000Z');

		const ids = (await repos.digest.listEventsNeedingContent(10, RETRY_ANY)).map((e) => e.event.id);
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
		await saveAsListed(id, content({ tags }), '2026-11-13T02:00:00.000Z');
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

describe('DigestRepository.mergeDraftEvent', () => {
	it('moves a draft’s articles to the target, deletes the draft and recomputes the target', async () => {
		const now = '2026-11-13T02:00:00.000Z';
		const target = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			now
		);
		const draft = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-12T20:00:00.000Z', { source: 'wire-b', publisher: 'Wire B' })],
			1,
			now
		);

		await repos.digest.mergeDraftEvent(draft, target, 0.9, '2026-11-13T03:00:00.000Z');

		expect(db.select().from(events).where(eq(events.id, draft)).get()).toBeUndefined();
		expect(getEvent(target)).toMatchObject({
			status: 'draft',
			source_count: 2,
			first_seen_at: '2026-11-12T20:00:00.000Z'
		});
		expect(
			(await repos.digest.listEventsNeedingContent(10, RETRY_ANY)).map((e) => e.event.id)
		).toEqual([target]);
	});

	it('never merges into a published event; flagPossibleDuplicate flags the draft and links them instead', async () => {
		const now = '2026-11-13T02:00:00.000Z';
		const published = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			now
		);
		await saveAsListed(published, content(), now);
		const before = getEvent(published);
		const draftArticle = await addArticle('2026-11-13T00:30:00.000Z', { publisher: 'Other Wire' });
		const draft = await repos.digest.createDraftEvent([draftArticle], 1, now);

		await expect(repos.digest.mergeDraftEvent(draft, published, 0.95, now)).rejects.toThrow(
			/into a published event/
		);
		const flagged = await repos.digest.flagPossibleDuplicate(
			draft,
			published,
			{
				explanation_th: 'อาจเป็นเหตุการณ์เดียวกัน',
				evidence_article_ids: [draftArticle],
				confidence: 0.9
			},
			'2026-11-13T03:00:00.000Z'
		);

		expect(flagged).toBe(true);
		expect(getEvent(draft)).toMatchObject({
			status: 'draft',
			review_reasons: ['possible_duplicate']
		});
		expect(getEvent(published)).toEqual(before);
		expect(db.select().from(eventRelations).all()).toMatchObject([
			{
				relation_type: 'same_topic',
				status: 'pending_review',
				explanation_th: 'อาจเป็นเหตุการณ์เดียวกัน',
				evidence_refs: [{ article_id: draftArticle }],
				confidence: 0.9,
				reviewed_at: null
			}
		]);
		// Not a published target, or no longer a draft: refused / nothing written.
		await expect(
			repos.digest.flagPossibleDuplicate(
				published,
				draft,
				{ explanation_th: 'ก', evidence_article_ids: [], confidence: 1 },
				now
			)
		).rejects.toThrow(/must be a published event/);
		db.update(events).set({ status: 'pending_review' }).where(eq(events.id, draft)).run();
		expect(
			await repos.digest.flagPossibleDuplicate(
				draft,
				published,
				{ explanation_th: 'ก', evidence_article_ids: [draftArticle], confidence: 1 },
				now
			)
		).toBe(false);
	});

	it('refuses to merge away a non-draft event, or into a hidden one', async () => {
		const now = '2026-11-13T02:00:00.000Z';
		const published = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			now
		);
		await saveAsListed(published, content(), now);
		const draft = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:10:00.000Z')],
			1,
			now
		);

		await expect(repos.digest.mergeDraftEvent(published, draft, 0.9, now)).rejects.toThrow(
			/cannot merge a published event/
		);
		db.update(events).set({ status: 'hidden' }).where(eq(events.id, published)).run();
		await expect(repos.digest.mergeDraftEvent(draft, published, 0.9, now)).rejects.toThrow(
			/into a hidden event/
		);
		expect(getEvent(draft).status).toBe('draft');
	});
});

describe('review fixes in DigestRepository', () => {
	const now = '2026-11-13T02:00:00.000Z';
	const editor = { changed_by: 'editor@example.com', change_reason: 'fix', public_note_th: null };

	it('mergeDraftEvent refuses to merge away a draft an admin edited, and never mixes demo and real', async () => {
		const target = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			now
		);
		const edited = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:05:00.000Z')],
			1,
			now
		);
		await repos.admin.updateEvent(edited, { title_th: 'หัวข้อของบรรณาธิการ' }, editor, now);
		const demo = await repos.digest.createDraftEvent(
			[
				await addArticle('2026-11-13T00:10:00.000Z', {
					source: 'demo-wire',
					publisher: 'Demo Wire'
				})
			],
			1,
			now
		);

		expect(await repos.digest.mergeDraftEvent(edited, target, 0.9, now)).toBe(false);
		expect(getEvent(edited).title_th).toBe('หัวข้อของบรรณาธิการ');
		await expect(repos.digest.mergeDraftEvent(demo, target, 0.9, now)).rejects.toThrow(
			/real and demo/
		);
		expect(await repos.digest.mergeDraftEvent(target, edited, 0.9, now)).toBe(true);
	});

	it('markContentChecked moves summarized_at forward on published events only', async () => {
		const id = await repos.digest.createDraftEvent(
			[await addArticle('2026-11-13T00:00:00.000Z')],
			1,
			now
		);
		await repos.digest.markContentChecked(
			id,
			'2026-11-13T05:00:00.000Z',
			'2026-11-13T06:00:00.000Z'
		);
		expect(getEvent(id).summarized_at).toBeNull();

		await saveAsListed(id, content(), now);
		await repos.digest.markContentChecked(
			id,
			'2026-11-13T05:00:00.000Z',
			'2026-11-13T06:00:00.000Z'
		);
		await repos.digest.markContentChecked(
			id,
			'2026-11-13T04:00:00.000Z',
			'2026-11-13T07:00:00.000Z'
		);
		expect(getEvent(id)).toMatchObject({
			summarized_at: '2026-11-13T05:00:00.000Z',
			title_th: content().title_th,
			// The admin editor's version token moves with the write that changed the row.
			updated_at: '2026-11-13T06:00:00.000Z'
		});
	});

	it('listEventsNeedingContent breaks last_updated_at ties by id', async () => {
		const sameTime = '2026-11-13T00:00:00.000Z';
		const ids = [];
		for (let index = 0; index < 3; index++) {
			ids.push(await repos.digest.createDraftEvent([await addArticle(sameTime)], 1, sameTime));
		}
		const listed = await repos.digest.listEventsNeedingContent(10, RETRY_ANY);
		expect(listed.map((item) => item.event.id)).toEqual([...ids].sort());
	});
});
