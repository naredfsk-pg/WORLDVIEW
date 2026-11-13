import { isActionFailure, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { contentRevisions, dailyBriefs, eventArticles, events } from '#lib/server/db/schema.js';
import { seedDatabase } from '#lib/server/db/seed.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import { createJobRunRepository } from '#lib/server/db/repositories/job-runs.js';
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import type { JobOutcome } from '#lib/types/jobs.js';

let db: Db;
let repos: ReturnType<typeof createRepositories>;

vi.mock('#lib/server/db/repositories/index.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/db/repositories/index.js')>();
	return { ...original, getRepositories: () => repos };
});

const { actions: reviewActions } = await import('./review/+page.server');
const { actions: editActions } = await import('./events/[id]/+page.server');
const { actions: relationActions } = await import('./relations/+page.server');
const { actions: briefActions } = await import('./briefs/+page.server');
const { startManualIngest } = await import('./jobs/manual-ingest.server');

const ADMIN = { email: 'editor@example.com' };

beforeEach(() => {
	db = openTestDb();
	seedDatabase(db, []);
	repos = createRepositories(db);
});
afterEach(() => db.$client.close());

function actionEvent(
	fields: Record<string, string>,
	options: { params?: Record<string, string>; admin?: typeof ADMIN | null } = {}
): RequestEvent {
	const request = new Request('http://localhost/admin/action', {
		method: 'POST',
		body: new URLSearchParams(fields)
	});
	const locals = options.admin === null ? {} : { admin: options.admin ?? ADMIN };
	return { request, locals, params: options.params ?? {} } as unknown as RequestEvent;
}

type AnyAction = (event: RequestEvent) => Promise<unknown>;
const call = (action: unknown, event: RequestEvent) => (action as AnyAction)(event);

const eventRow = (id: string) => db.select().from(events).where(eq(events.id, id)).get()!;
const revisionsFor = (id: string) =>
	db.select().from(contentRevisions).where(eq(contentRevisions.entity_id, id)).all();

describe('event status actions (review queue)', () => {
	it('publish runs the admin gates G1–G3 and publishes with a revision', async () => {
		const result = await call(
			reviewActions.publish,
			actionEvent({ id: 'demo-evt-13', change_reason: 'ตรวจแหล่งข่าวแล้ว' })
		);

		expect(result).toMatchObject({ ok: true, id: 'demo-evt-13' });
		expect(eventRow('demo-evt-13')).toMatchObject({ status: 'published', review_reasons: [] });
		expect(await repos.read.getPublishedEventDetail('demo-evt-13')).not.toBeNull();
		expect(revisionsFor('demo-evt-13')[0]).toMatchObject({
			changed_by: ADMIN.email,
			change_reason: 'ตรวจแหล่งข่าวแล้ว'
		});
	});

	it('publish fails with the gate reasons and changes nothing', async () => {
		db.update(events)
			.set({ title_th: 'Breaking news', summary_th: 'อ่านต่อที่ https://evil.example.com' })
			.where(eq(events.id, 'demo-evt-13'))
			.run();
		db.delete(eventArticles).where(eq(eventArticles.event_id, 'demo-evt-13')).run();

		const result = await call(
			reviewActions.publish,
			actionEvent({ id: 'demo-evt-13', change_reason: 'ลองเผยแพร่' })
		);

		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({
			status: 422,
			data: {
				ok: false,
				reasons: ['no_source', 'url_in_generated_text', 'missing_thai_fields']
			}
		});
		expect(eventRow('demo-evt-13').status).toBe('pending_review');
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
	});

	it('hides a published event (public 404) and unhides it through the gates', async () => {
		const hide = await call(
			reviewActions.hide,
			actionEvent({ id: 'demo-evt-01', change_reason: 'ข้อมูลผิด' })
		);
		expect(hide).toMatchObject({ ok: true });
		expect(await repos.read.getPublishedEventDetail('demo-evt-01')).toBeNull();

		const unhide = await call(
			reviewActions.publish,
			actionEvent({ id: 'demo-evt-01', change_reason: 'แก้ไขแล้ว' })
		);
		expect(unhide).toMatchObject({ ok: true });
		expect(await repos.read.getPublishedEventDetail('demo-evt-01')).not.toBeNull();
		expect(revisionsFor('demo-evt-01')).toHaveLength(2);
	});

	it('unhide is refused when the hidden event no longer passes G1–G3', async () => {
		await call(reviewActions.hide, actionEvent({ id: 'demo-evt-01', change_reason: 'ข้อมูลผิด' }));
		db.update(events).set({ category: null }).where(eq(events.id, 'demo-evt-01')).run();

		const result = await call(
			reviewActions.publish,
			actionEvent({ id: 'demo-evt-01', change_reason: 'ลองเลิกซ่อน' })
		);
		expect(result).toMatchObject({ status: 422, data: { reasons: ['missing_thai_fields'] } });
		expect(eventRow('demo-evt-01').status).toBe('hidden');
	});

	it('flag adds manual_flag', async () => {
		const result = await call(
			reviewActions.flag,
			actionEvent({ id: 'demo-evt-13', change_reason: 'ต้องตรวจเพิ่ม' })
		);
		expect(result).toMatchObject({ ok: true });
		expect(eventRow('demo-evt-13').review_reasons).toContain('manual_flag');
	});

	it('requires a change_reason and a valid id', async () => {
		const noReason = await call(reviewActions.publish, actionEvent({ id: 'demo-evt-13' }));
		expect(noReason).toMatchObject({ status: 400, data: { ok: false, id: 'demo-evt-13' } });

		const shortReason = await call(
			reviewActions.hide,
			actionEvent({ id: 'demo-evt-13', change_reason: 'ok' })
		);
		expect(shortReason).toMatchObject({ status: 400 });

		const badId = await call(
			reviewActions.hide,
			actionEvent({ id: '<script>', change_reason: 'ซ่อนก่อน' })
		);
		expect(badId).toMatchObject({ status: 400, data: { id: null } });

		const unknown = await call(
			reviewActions.hide,
			actionEvent({ id: 'missing-id', change_reason: 'ซ่อนก่อน' })
		);
		expect(unknown).toMatchObject({ status: 404 });
		expect(eventRow('demo-evt-13').status).toBe('pending_review');
	});

	it('refuses to run without a verified admin (defence in depth)', async () => {
		await expect(
			call(
				reviewActions.publish,
				actionEvent({ id: 'demo-evt-13', change_reason: 'ตรวจแล้ว' }, { admin: null })
			)
		).rejects.toSatisfy((error: unknown) => isHttpError(error, 403));
		expect(eventRow('demo-evt-13').status).toBe('pending_review');
	});
});

describe('event edit (save)', () => {
	const validFields = {
		title_th: 'หัวข้อที่แก้ไขแล้ว',
		summary_th: 'สรุปสั้นที่แก้ไขแล้ว',
		what_happened_th: 'รายละเอียดสิ่งที่เกิดขึ้น',
		why_it_matters_th: 'เหตุผลที่เรื่องนี้สำคัญ',
		background_th: '',
		uncertain_th: 'ยังไม่ทราบตัวเลขที่แน่ชัด',
		category: 'geopolitics',
		change_reason: 'ปรับถ้อยคำ',
		public_note_th: 'แก้ไขหัวข้อให้ชัดเจนขึ้น'
	};
	const save = (fields: Record<string, string>) =>
		call(editActions.save, actionEvent(fields, { params: { id: 'demo-evt-13' } }));

	it('saves only changed fields with a before/after revision', async () => {
		const before = eventRow('demo-evt-13');
		const result = await save(validFields);

		expect(result).toMatchObject({ ok: true });
		const after = eventRow('demo-evt-13');
		expect(after).toMatchObject({ title_th: 'หัวข้อที่แก้ไขแล้ว', background_th: null });
		const revision = revisionsFor('demo-evt-13')[0]!;
		expect(revision).toMatchObject({
			changed_by: ADMIN.email,
			change_reason: 'ปรับถ้อยคำ',
			public_note_th: 'แก้ไขหัวข้อให้ชัดเจนขึ้น'
		});
		expect(revision.before_after.before).toMatchObject({ title_th: before.title_th });
		expect(revision.before_after.after).toMatchObject({ title_th: 'หัวข้อที่แก้ไขแล้ว' });
		// Unchanged fields (category, background_th) are not part of the revision.
		expect(Object.keys(revision.before_after.after ?? {})).not.toContain('category');
		expect(Object.keys(revision.before_after.after ?? {})).not.toContain('background_th');
	});

	it.each([
		['a URL in the title', { title_th: 'ดูเพิ่มที่ https://example.com/x' }, 'title_th'],
		['a bare domain in the summary', { summary_th: 'ข่าวจาก evil-news.example.com' }, 'summary_th'],
		['no Thai text in a required field', { what_happened_th: 'English only' }, 'what_happened_th'],
		['an empty required field', { why_it_matters_th: '   ' }, 'why_it_matters_th'],
		['a too long title', { title_th: 'ก'.repeat(201) }, 'title_th'],
		['a URL in an optional field', { background_th: 'www.example.com' }, 'background_th'],
		['an unknown category', { category: 'sports' }, 'category'],
		['a missing change reason', { change_reason: '' }, 'change_reason']
	])('rejects %s with a field error and keeps the input', async (_name, overrides, field) => {
		const result = await save({ ...validFields, ...overrides });

		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({ status: 400, data: { ok: false } });
		const data = (result as { data: { field_errors: Record<string, string>; values: object } })
			.data;
		expect(data.field_errors[field]).toBeTruthy();
		expect(data.values).toMatchObject(overrides);
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
	});

	it('reports when nothing changed', async () => {
		const current = eventRow('demo-evt-13');
		const result = await save({
			title_th: current.title_th,
			summary_th: current.summary_th,
			what_happened_th: current.what_happened_th,
			why_it_matters_th: current.why_it_matters_th,
			background_th: current.background_th ?? '',
			uncertain_th: current.uncertain_th ?? '',
			category: current.category ?? '',
			change_reason: 'ไม่ได้แก้อะไร'
		});
		expect(result).toMatchObject({ status: 400, data: { message: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' } });
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
	});
});

describe('relations and briefs', () => {
	it('approves and rejects pending relations, each with a revision', async () => {
		const approve = await call(
			relationActions.approve,
			actionEvent({ id: 'demo-rel-06', change_reason: 'หลักฐานครบ' })
		);
		expect(approve).toMatchObject({ ok: true });
		expect(revisionsFor('demo-rel-06')).toHaveLength(1);

		const again = await call(
			relationActions.reject,
			actionEvent({ id: 'demo-rel-06', change_reason: 'เปลี่ยนใจ' })
		);
		expect(again).toMatchObject({ status: 409 });
		expect(revisionsFor('demo-rel-06')).toHaveLength(1);
	});

	it('hides and unhides a brief with a revision', async () => {
		const [latest] = await repos.admin.listRecentBriefs(1);
		const hide = await call(
			briefActions.visibility,
			actionEvent({ id: latest!.id, status: 'hidden', change_reason: 'มีข่าวผิด' })
		);
		expect(hide).toMatchObject({ ok: true });
		expect(db.select().from(dailyBriefs).where(eq(dailyBriefs.id, latest!.id)).get()?.status).toBe(
			'hidden'
		);

		const badStatus = await call(
			briefActions.visibility,
			actionEvent({ id: latest!.id, status: 'draft', change_reason: 'ลองดู' })
		);
		expect(badStatus).toMatchObject({ status: 400 });

		const unhide = await call(
			briefActions.visibility,
			actionEvent({ id: latest!.id, status: 'published', change_reason: 'แก้แล้ว' })
		);
		expect(unhide).toMatchObject({ ok: true });
		expect(revisionsFor(latest!.id)).toHaveLength(2);
	});
});

describe('manual ingest rerun', () => {
	it('claims the slot with --force --manual and never starts a running slot twice', async () => {
		let finishFirst!: (outcome: JobOutcome) => void;
		const execute = vi.fn(() => new Promise<JobOutcome>((resolve) => (finishFirst = resolve)));
		const deps = {
			jobs: createJobRunRepository(db),
			logger: createJsonLogger(() => {}),
			now: () => new Date('2026-11-13T05:10:00.000Z'),
			execute
		};

		expect(await startManualIngest(deps)).toEqual({ status: 'started' });
		expect(await startManualIngest(deps)).toEqual({ status: 'skipped_running' });
		expect(execute).toHaveBeenCalledOnce();

		const [run] = await deps.jobs.listRecent(1);
		expect(run).toMatchObject({
			job_type: 'ingest',
			idempotency_key: 'ingest:2026-11-13T12',
			trigger: 'manual',
			status: 'running'
		});

		finishFirst({ status: 'succeeded', counters: { sources_ok: 1 }, error: null });
		await vi.waitFor(async () =>
			expect((await deps.jobs.listRecent(1))[0]?.status).toBe('succeeded')
		);
		// Finished slot + force → a new attempt of the same slot (idempotent rerun).
		expect(await startManualIngest(deps)).toEqual({ status: 'started' });
		expect((await deps.jobs.listRecent(1))[0]?.attempts).toBe(2);
		finishFirst({ status: 'succeeded', counters: {}, error: null });
	});
});
