import { isActionFailure, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import {
	contentRevisions,
	dailyBriefs,
	eventArticles,
	eventRelations,
	events
} from '#lib/server/db/schema.js';
import { seedDatabase } from '#lib/server/db/seed.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import { createJobRunRepository } from '#lib/server/db/repositories/job-runs.js';
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import type { JobContext, JobOutcome } from '#lib/types/jobs.js';

let db: Db;
let repos: ReturnType<typeof createRepositories>;

vi.mock('#lib/server/db/repositories/index.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/db/repositories/index.js')>();
	return { ...original, getRepositories: () => repos };
});

/** The rerun action gets fake ingest deps: no network, the test controls when the job ends. */
let fakeExecute: (ctx: JobContext) => Promise<JobOutcome>;
vi.mock('./jobs/manual-ingest.server', async (importOriginal) => {
	const original = await importOriginal<typeof import('./jobs/manual-ingest.server')>();
	return {
		...original,
		productionIngestDeps: () => ({
			jobs: repos.jobs,
			logger: createJsonLogger(() => {}),
			now: () => new Date(),
			execute: (ctx: JobContext) => fakeExecute(ctx)
		})
	};
});

const { actions: reviewActions } = await import('./review/+page.server');
const { actions: editActions } = await import('./events/[id]/+page.server');
const { actions: relationActions } = await import('./relations/+page.server');
const { actions: briefActions } = await import('./briefs/+page.server');
const { actions: jobActions } = await import('./jobs/+page.server');
const { MANUAL_RERUN_MIN_INTERVAL_MS, startManualIngest } =
	await import('./jobs/manual-ingest.server');

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
	const EDITABLE = [
		'title_th',
		'summary_th',
		'what_happened_th',
		'why_it_matters_th',
		'background_th',
		'uncertain_th',
		'category'
	] as const;

	/** The hidden fields the edit page renders: version token + the values it was loaded with. */
	function loadedFields(id = 'demo-evt-13'): Record<string, string> {
		const row = eventRow(id);
		const fields: Record<string, string> = { loaded_updated_at: row.updated_at };
		for (const name of EDITABLE) fields[`original_${name}`] = row[name] ?? '';
		return fields;
	}
	const save = (fields: Record<string, string>, loaded = loadedFields()) =>
		call(
			editActions.save,
			actionEvent({ ...loaded, ...fields }, { params: { id: 'demo-evt-13' } })
		);

	it('saves only changed fields with a before/after revision', async () => {
		const before = eventRow('demo-evt-13');
		const result = await save(validFields);

		expect(result).toMatchObject({ ok: true });
		const after = eventRow('demo-evt-13');
		expect(after).toMatchObject({ title_th: 'หัวข้อที่แก้ไขแล้ว', background_th: null });
		expect(after.updated_at).not.toBe(before.updated_at);
		const revision = revisionsFor('demo-evt-13')[0]!;
		expect(revision).toMatchObject({
			entity_type: 'event',
			entity_id: 'demo-evt-13',
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

	it('rejects a stale form with 409 when the row changed since it was loaded', async () => {
		const loaded = loadedFields();
		// The digest (or another admin) writes after the page was opened: updated_at moves.
		db.update(events)
			.set({ summary_th: 'สรุปใหม่จากระบบ', updated_at: '2026-11-13T09:00:00.000Z' })
			.where(eq(events.id, 'demo-evt-13'))
			.run();

		const result = await save(validFields, loaded);

		expect(result).toMatchObject({
			status: 409,
			data: { ok: false, message: expect.stringContaining('โหลดใหม่') }
		});
		expect((result as { data: { values: object } }).data.values).toMatchObject({
			title_th: validFields.title_th
		});
		expect(eventRow('demo-evt-13').summary_th).toBe('สรุปใหม่จากระบบ');
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
	});

	it('never writes a field the editor did not touch, even if the row differs from the form', async () => {
		const loaded = loadedFields();
		const original = eventRow('demo-evt-13');
		// A writer that did not move updated_at (worst case): the patch must still leave it alone.
		db.update(events)
			.set({ summary_th: 'สรุปที่ระบบเขียนไว้' })
			.where(eq(events.id, 'demo-evt-13'))
			.run();

		const untouched = Object.fromEntries(
			EDITABLE.map((name) => [name, original[name] ?? ''])
		) as Record<string, string>;
		const result = await save(
			{ ...untouched, title_th: 'หัวข้อใหม่จากผู้ดูแล', change_reason: 'แก้หัวข้อ' },
			loaded
		);

		expect(result).toMatchObject({ ok: true });
		const row = eventRow('demo-evt-13');
		expect(row.title_th).toBe('หัวข้อใหม่จากผู้ดูแล');
		expect(row.summary_th).toBe('สรุปที่ระบบเขียนไว้');
		expect(Object.keys(revisionsFor('demo-evt-13')[0]?.before_after.after ?? {})).toEqual([
			'title_th'
		]);
	});

	it('asks for a reload when the version fields are missing', async () => {
		const result = await save(validFields, {});
		expect(result).toMatchObject({
			status: 400,
			data: { message: expect.stringContaining('โหลด') }
		});
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
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

		const approveAgain = await call(
			relationActions.approve,
			actionEvent({ id: 'demo-rel-06', change_reason: 'ซ้ำ' + 'อีก' })
		);
		expect(approveAgain).toMatchObject({ status: 409 });
		expect(revisionsFor('demo-rel-06')).toHaveLength(1);
	});

	it('unpublishes a published relation (published → rejected) with a revision', async () => {
		expect((await repos.admin.listPublishedRelations(50)).map((row) => row.id)).toContain(
			'demo-rel-01'
		);
		const result = await call(
			relationActions.reject,
			actionEvent({ id: 'demo-rel-01', change_reason: 'ความเชื่อมโยงผิด' })
		);

		expect(result).toMatchObject({ ok: true });
		expect(
			db.select().from(eventRelations).where(eq(eventRelations.id, 'demo-rel-01')).get()
		).toMatchObject({ status: 'rejected', reviewed_by: ADMIN.email });
		expect(revisionsFor('demo-rel-01')[0]?.before_after).toEqual({
			before: { status: 'published' },
			after: { status: 'rejected' }
		});
		expect((await repos.admin.listPublishedRelations(50)).map((row) => row.id)).not.toContain(
			'demo-rel-01'
		);
	});

	it('lists pending relations whose events have no category yet', async () => {
		db.update(events).set({ category: null }).where(eq(events.id, 'demo-evt-05')).run();
		const { relations } = await repos.admin.listReviewQueue();
		const row = relations.find((relation) => relation.id === 'demo-rel-06');
		expect(row?.from_event).toMatchObject({ id: 'demo-evt-05', category: null });
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

		expect(await startManualIngest(deps)).toMatchObject({
			status: 'started',
			run: { idempotency_key: 'ingest:2026-11-13T12', attempts: 1 }
		});
		expect(await startManualIngest(deps)).toEqual({ status: 'skipped', reason: 'running' });
		expect(execute).toHaveBeenCalledOnce();

		const [run] = await deps.jobs.listRecent(1);
		expect(run).toMatchObject({ job_type: 'ingest', trigger: 'manual', status: 'running' });

		finishFirst({ status: 'succeeded', counters: { sources_ok: 1 }, error: null });
		await vi.waitFor(async () =>
			expect((await deps.jobs.listRecent(1))[0]?.status).toBe('succeeded')
		);
		// Finished slot + force → a new attempt of the same slot (idempotent rerun).
		expect(await startManualIngest(deps)).toMatchObject({
			status: 'started',
			run: { attempts: 2 }
		});
		finishFirst({ status: 'succeeded', counters: {}, error: null });
	});

	describe('?/rerunIngest action', () => {
		let finish: ((outcome: JobOutcome) => void) | null;
		beforeEach(() => {
			finish = null;
			fakeExecute = () => new Promise<JobOutcome>((resolve) => (finish = resolve));
		});
		afterEach(() => finish?.({ status: 'succeeded', counters: {}, error: null }));

		const rerun = (fields: Record<string, string>) =>
			call(jobActions.rerunIngest, actionEvent(fields));

		it('requires a change_reason', async () => {
			expect(await rerun({})).toMatchObject({ status: 400 });
			expect(await repos.admin.listRecentAdminActions('rerun_ingest', 5)).toEqual([]);
		});

		it('starts the run and records the actor and reason, then enforces the interval', async () => {
			expect(await rerun({ change_reason: 'ฟีดเพิ่งกลับมา' })).toMatchObject({ ok: true });

			const [audit] = await repos.admin.listRecentAdminActions('rerun_ingest', 5);
			expect(audit).toMatchObject({
				action: 'rerun_ingest',
				actor: ADMIN.email,
				reason: 'ฟีดเพิ่งกลับมา',
				target: expect.stringMatching(/^ingest:\d{4}-\d{2}-\d{2}T\d{2}#1$/)
			});

			finish?.({ status: 'succeeded', counters: {}, error: null });
			const again = await rerun({ change_reason: 'ลองอีกรอบ' });
			expect(again).toMatchObject({
				status: 429,
				data: { message: expect.stringContaining(`${MANUAL_RERUN_MIN_INTERVAL_MS / 60_000} นาที`) }
			});
			expect(await repos.admin.listRecentAdminActions('rerun_ingest', 5)).toHaveLength(1);
		});

		it('reports the real skip reason when the slot is already running', async () => {
			// A cron (or CLI) run holds the claim; no manual start is on record.
			await startManualIngest({
				jobs: repos.jobs,
				logger: createJsonLogger(() => {}),
				now: () => new Date(),
				execute: fakeExecute
			});

			const result = await rerun({ change_reason: 'ลองสั่งรัน' });
			expect(result).toMatchObject({
				status: 409,
				data: { message: expect.stringContaining('กำลังทำงานอยู่') }
			});
			expect(await repos.admin.listRecentAdminActions('rerun_ingest', 5)).toEqual([]);
		});
	});
});
