import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client';
import { contentRevisions, events } from '../schema';
import { seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { createRepositories } from './index';

let db: Db;
let repos: ReturnType<typeof createRepositories>;
const meta = { changed_by: 'admin@example.com', change_reason: 'review', public_note_th: null };

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
});
