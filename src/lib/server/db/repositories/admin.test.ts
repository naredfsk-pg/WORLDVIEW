import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../client';
import { articles, contentRevisions, eventRelations, events } from '../schema';
import { seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { filterAllegationTags } from '../../editorial/tag-filter';
import { adminEditedContentFields } from './digest';
import { createRepositories } from './index';

let db: Db;
let repos: ReturnType<typeof createRepositories>;
const meta = { changed_by: 'admin@example.com', change_reason: 'review', public_note_th: null };
const keepTags = (tags: string[]) => [...tags];

beforeEach(() => {
	db = openTestDb();
	seedDatabase(db, []);
	repos = createRepositories(db);
});
afterEach(() => db.$client.close());

describe('AdminRepository', () => {
	it('lists the review queue: pending events and pending relations', async () => {
		const queue = await repos.admin.listReviewQueue();

		expect(queue.events.map((event) => event.id)).toEqual(['demo-evt-13']);
		expect(queue.events[0]?.fallback_title).toContain('[ตัวอย่าง]');
		expect(queue.relations.map((relation) => relation.id)).toEqual(['demo-rel-06']);
		expect(await repos.admin.countReviewQueue()).toEqual({ events: 1, relations: 1 });
	});

	it('publishes an event with an audit revision, making it public', async () => {
		await repos.admin.setEventStatus('demo-evt-13', 'published', meta, '2026-11-13T05:00:00.000Z');

		const row = db.select().from(events).where(eq(events.id, 'demo-evt-13')).get();
		expect(row).toMatchObject({
			status: 'published',
			review_reasons: [],
			published_at: '2026-11-13T05:00:00.000Z'
		});
		expect(await repos.read.getPublishedEventDetail('demo-evt-13')).not.toBeNull();
		const revisions = db
			.select()
			.from(contentRevisions)
			.where(eq(contentRevisions.entity_id, 'demo-evt-13'))
			.all();
		expect(revisions).toHaveLength(1);
		expect(revisions[0]).toMatchObject({
			changed_by: 'admin@example.com',
			change_reason: 'review'
		});
	});

	it('records only changed fields in the revision and shows public notes as corrections', async () => {
		await repos.admin.updateEvent(
			'demo-evt-02',
			{ title_th: 'หัวข้อแก้ไขแล้ว', summary_th: undefined },
			{ ...meta, public_note_th: 'แก้ไขหัวข้อ' },
			'2026-11-13T05:00:00.000Z'
		);

		const edit = await repos.admin.getEventForEdit('demo-evt-02');
		expect(edit?.event.title_th).toBe('หัวข้อแก้ไขแล้ว');
		expect(edit?.revisions[0]?.before_after.after).toEqual({ title_th: 'หัวข้อแก้ไขแล้ว' });
		expect((await repos.read.getPublishedEventDetail('demo-evt-02'))?.corrections).toEqual([
			{ changed_at: '2026-11-13T05:00:00.000Z', note_th: 'แก้ไขหัวข้อ' }
		]);
	});

	it('throws for unknown ids and lists source health', async () => {
		await expect(
			repos.admin.setEventStatus('nope', 'hidden', meta, '2026-11-13T05:00:00.000Z')
		).rejects.toThrow(/not found/);
		expect((await repos.admin.listSourceHealth()).every((source) => source.is_demo)).toBe(true);
	});

	it('shows stored excerpts on the admin event view only', async () => {
		const excerpt = 'Internal excerpt for the admin view.';
		db.update(articles).set({ excerpt }).where(eq(articles.id, 'demo-art-01a')).run();

		const edit = await repos.admin.getEventForEdit('demo-evt-01');
		const publicDetail = await repos.read.getPublishedEventDetail('demo-evt-01');

		expect(edit?.sources.find((source) => source.article_id === 'demo-art-01a')?.excerpt).toBe(
			excerpt
		);
		expect(edit?.sources.map((source) => source.article_id)).toEqual(
			publicDetail?.sources.map((source) => source.article_id)
		);
		expect(JSON.stringify(publicDetail)).not.toContain(excerpt);
	});
});

describe('AdminRepository state-checked transitions (Wave 2 admin)', () => {
	const now = '2026-11-13T06:00:00.000Z';
	const revisionsFor = (id: string) =>
		db.select().from(contentRevisions).where(eq(contentRevisions.entity_id, id)).all();

	it('publishEvent runs the gate on the current row and linked articles inside the write', async () => {
		let seen: { status: string; articles: string[] } | null = null;
		const result = await repos.admin.publishEvent(
			'demo-evt-13',
			(current) => {
				seen = {
					status: current.event.status,
					articles: current.articles.map((article) => article.canonical_url)
				};
				return [];
			},
			meta,
			now,
			keepTags
		);

		expect(result).toEqual({ ok: true });
		expect(seen).toEqual({
			status: 'pending_review',
			articles: [expect.stringMatching(/^https:\/\/example\.com\/demo\//)]
		});
		expect(await repos.read.getPublishedEventDetail('demo-evt-13')).not.toBeNull();
		expect(revisionsFor('demo-evt-13')[0]?.before_after).toEqual({
			before: { status: 'pending_review', review_reasons: ['sensitive_single_source'] },
			after: { status: 'published', review_reasons: [] }
		});
	});

	it('publishEvent drops allegation tags of pipeline tags, with a system revision', async () => {
		db.update(events)
			.set({ tags: ['nvidia', 'extramarital-affair', 'alleged-spy', 'semiconductors'] })
			.where(eq(events.id, 'demo-evt-13'))
			.run();

		const result = await repos.admin.publishEvent(
			'demo-evt-13',
			() => [],
			meta,
			now,
			filterAllegationTags
		);

		expect(result).toEqual({ ok: true });
		expect(db.select().from(events).where(eq(events.id, 'demo-evt-13')).get()).toMatchObject({
			status: 'published',
			tags: ['nvidia', 'semiconductors']
		});
		const tagRevision = revisionsFor('demo-evt-13').find((row) => row.changed_by === 'system');
		expect(tagRevision?.before_after.after).toEqual({ tags: ['nvidia', 'semiconductors'] });
	});

	it('publishEvent keeps tags an admin edited, even allegation tags', async () => {
		await repos.admin.updateEvent(
			'demo-evt-13',
			{ tags: ['nvidia', 'alleged-spy'] },
			{ ...meta, change_reason: 'editor choice' },
			now
		);

		await repos.admin.publishEvent('demo-evt-13', () => [], meta, now, filterAllegationTags);

		expect(db.select().from(events).where(eq(events.id, 'demo-evt-13')).get()?.tags).toEqual([
			'nvidia',
			'alleged-spy'
		]);
	});

	it('publishEvent writes nothing when the gate returns reasons', async () => {
		const result = await repos.admin.publishEvent(
			'demo-evt-13',
			() => ['no_source'],
			meta,
			now,
			keepTags
		);

		expect(result).toEqual({ ok: false, error: 'gate_failed', reasons: ['no_source'] });
		expect(db.select().from(events).where(eq(events.id, 'demo-evt-13')).get()?.status).toBe(
			'pending_review'
		);
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
	});

	it('rejects transitions from the wrong state and unknown ids', async () => {
		expect(await repos.admin.publishEvent('demo-evt-01', () => [], meta, now, keepTags)).toEqual({
			ok: false,
			error: 'invalid_state'
		});
		expect(await repos.admin.flagEvent('demo-evt-01', meta, now)).toEqual({
			ok: false,
			error: 'invalid_state'
		});
		expect(await repos.admin.hideEvent('nope', meta, now)).toEqual({
			ok: false,
			error: 'not_found'
		});
		expect(revisionsFor('demo-evt-01')).toHaveLength(0);
	});

	it('hides and republishes (hidden → published goes through the gate again)', async () => {
		expect(await repos.admin.hideEvent('demo-evt-01', meta, now)).toEqual({ ok: true });
		expect(await repos.read.getPublishedEventDetail('demo-evt-01')).toBeNull();
		expect(await repos.admin.hideEvent('demo-evt-01', meta, now)).toEqual({
			ok: false,
			error: 'invalid_state'
		});
		expect((await repos.admin.listHiddenEvents(10)).map((row) => row.id)).toEqual(['demo-evt-01']);

		const gate = vi.fn(() => []);
		expect(await repos.admin.publishEvent('demo-evt-01', gate, meta, now, keepTags)).toEqual({
			ok: true
		});
		expect(gate).toHaveBeenCalledOnce();
		expect(await repos.read.getPublishedEventDetail('demo-evt-01')).not.toBeNull();
		expect(revisionsFor('demo-evt-01')).toHaveLength(2);
	});

	it('flagEvent adds manual_flag once and keeps the event in review', async () => {
		expect(await repos.admin.flagEvent('demo-evt-13', meta, now)).toEqual({ ok: true });
		expect(await repos.admin.flagEvent('demo-evt-13', meta, now)).toEqual({ ok: true });

		const row = db.select().from(events).where(eq(events.id, 'demo-evt-13')).get();
		expect(row).toMatchObject({
			status: 'pending_review',
			review_reasons: ['sensitive_single_source', 'manual_flag']
		});
		expect(revisionsFor('demo-evt-13')).toHaveLength(2);
	});

	it('reviewRelation approves or rejects pending relations only', async () => {
		expect(await repos.admin.reviewRelation('demo-rel-06', 'rejected', meta, now)).toEqual({
			ok: true
		});
		const row = db.select().from(eventRelations).where(eq(eventRelations.id, 'demo-rel-06')).get();
		expect(row).toMatchObject({
			status: 'rejected',
			reviewed_at: now,
			reviewed_by: meta.changed_by
		});
		expect(await repos.admin.reviewRelation('demo-rel-06', 'published', meta, now)).toEqual({
			ok: false,
			error: 'invalid_state'
		});
		expect(revisionsFor('demo-rel-06')[0]?.entity_type).toBe('event_relation');
	});

	it('rejecting a relation also rejects the unreviewed relations of that pair, both directions', async () => {
		// demo-rel-01 (evt-12 → evt-07) is auto-published (reviewed_at null). Add two siblings: one
		// reverse and unreviewed, one an admin approved earlier.
		const base = db
			.select()
			.from(eventRelations)
			.where(eq(eventRelations.id, 'demo-rel-01'))
			.get()!;
		db.insert(eventRelations)
			.values([
				{
					...base,
					id: 'sibling-reverse',
					from_event_id: base.to_event_id,
					to_event_id: base.from_event_id,
					relation_type: 'follow_up',
					status: 'pending_review'
				},
				{
					...base,
					id: 'sibling-approved',
					relation_type: 'same_topic',
					reviewed_at: '2026-11-13T00:00:00.000Z',
					reviewed_by: 'other-admin@example.com'
				}
			])
			.run();

		expect(await repos.admin.reviewRelation('demo-rel-01', 'rejected', meta, now)).toEqual({
			ok: true
		});

		const status = (id: string) =>
			db.select().from(eventRelations).where(eq(eventRelations.id, id)).get()!;
		expect(status('sibling-reverse')).toMatchObject({
			status: 'rejected',
			reviewed_at: now,
			reviewed_by: meta.changed_by
		});
		expect(status('sibling-approved')).toMatchObject({ status: 'published' });
		expect(revisionsFor('sibling-reverse')[0]).toMatchObject({
			changed_by: meta.changed_by,
			change_reason: 'review (same pair as rejected relation demo-rel-01)'
		});
		expect(revisionsFor('sibling-approved')).toEqual([]);
		// The other pairs are untouched.
		expect(status('demo-rel-02').status).toBe('published');
	});

	it('releasing a credibility override hands the label back to the pipeline', async () => {
		const row = () => db.select().from(events).where(eq(events.id, 'demo-evt-04')).get()!;
		await repos.admin.updateEventIfCurrent(
			'demo-evt-04',
			row().updated_at,
			{ credibility_level: 'unverified', credibility_reason_th: 'ยังไม่มีการยืนยัน' },
			meta,
			'2026-11-13T05:00:00.000Z'
		);
		expect(adminEditedContentFields(db, 'demo-evt-04')).toEqual(
			new Set(['credibility_level', 'credibility_reason_th'])
		);

		const result = await repos.admin.updateEventIfCurrent(
			'demo-evt-04',
			row().updated_at,
			{},
			meta,
			'2026-11-13T06:00:00.000Z',
			{ releaseCredibility: true }
		);

		expect(result).toEqual({ ok: true });
		// The stored label stays until the next re-summary; nothing is admin-owned any more.
		expect(row()).toMatchObject({
			credibility_level: 'unverified',
			updated_at: '2026-11-13T06:00:00.000Z'
		});
		expect(adminEditedContentFields(db, 'demo-evt-04')).toEqual(new Set());
		expect(revisionsFor('demo-evt-04').at(-1)!.before_after).toEqual({
			before: { credibility_level: 'unverified', credibility_reason_th: 'ยังไม่มีการยืนยัน' },
			after: { credibility_release: true }
		});
		// A later override locks the label again.
		await repos.admin.updateEventIfCurrent(
			'demo-evt-04',
			row().updated_at,
			{ credibility_level: 'disputed', credibility_reason_th: null },
			meta,
			'2026-11-13T07:00:00.000Z'
		);
		expect(adminEditedContentFields(db, 'demo-evt-04').has('credibility_level')).toBe(true);
	});

	it('lists briefs and toggles published ↔ hidden with a revision', async () => {
		const briefs = await repos.admin.listRecentBriefs(3);
		expect(briefs).toHaveLength(3);
		const latest = briefs[0]!;
		expect(latest.brief_date >= briefs[2]!.brief_date).toBe(true);

		expect(await repos.admin.setBriefVisibility(latest.id, 'hidden', meta, now)).toEqual({
			ok: true
		});
		expect(await repos.admin.setBriefVisibility(latest.id, 'hidden', meta, now)).toEqual({
			ok: false,
			error: 'invalid_state'
		});
		expect(await repos.admin.setBriefVisibility(latest.id, 'published', meta, now)).toEqual({
			ok: true
		});
		expect(revisionsFor(latest.id).map((revision) => revision.entity_type)).toEqual([
			'daily_brief',
			'daily_brief'
		]);
	});

	it('llmUsageSince counts calls, tokens, failures and job-counter cache hits', async () => {
		const call = {
			task: 'summary' as const,
			model: 'cc/test',
			prompt_version: 'summary@1',
			cache_key: 'k',
			output_json: null,
			job_run_id: null,
			latency_ms: 10
		};
		await repos.llmCalls.record({
			...call,
			created_at: '2026-11-13T01:00:00.000Z',
			status: 'ok',
			error_kind: null,
			tokens_in: 100,
			tokens_out: 50
		});
		await repos.llmCalls.record({
			...call,
			created_at: '2026-11-13T02:00:00.000Z',
			status: 'error',
			error_kind: 'timeout',
			tokens_in: 0,
			tokens_out: 0
		});
		await repos.llmCalls.record({
			...call,
			created_at: '2026-11-12T01:00:00.000Z',
			status: 'error',
			error_kind: 'timeout',
			tokens_in: 7,
			tokens_out: 0
		});
		const claimed = await repos.jobs.claim({
			job_type: 'digest',
			idempotency_key: 'digest:2026-11-13T08',
			scheduled_for: '2026-11-13T01:00:00.000Z',
			trigger: 'cron',
			force: false,
			now: '2026-11-13T01:00:00.000Z'
		});
		if (!claimed.claimed) throw new Error('claim failed');
		await repos.jobs.finish(
			claimed.run.id,
			claimed.run.attempts,
			{ status: 'succeeded', counters: { llm_cache_hits: 4 }, error: null },
			'2026-11-13T01:05:00.000Z'
		);

		expect(await repos.admin.llmUsageSince('2026-11-12T17:00:00.000Z')).toEqual({
			requests: 2,
			tokens: 150,
			failures: 1,
			cache_hits: 4
		});
	});
});
