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
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import type { RunJobByTypeResult, RunJobOptions } from '#lib/server/jobs/registry.js';
import { runJob } from '#lib/server/jobs/runner.js';
import type { JobContext, JobOutcome, JobType } from '#lib/types/jobs.js';

let db: Db;
let repos: ReturnType<typeof createRepositories>;

vi.mock('#lib/server/db/repositories/index.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/db/repositories/index.js')>();
	return { ...original, getRepositories: () => repos };
});

/**
 * The rerun action gets a fake `runJobByType`: the real claim (`runJob` on the test database), no
 * network, and the test controls when the job ends. A date of 2099-01-01 is a window that has
 * not closed yet.
 */
let fakeExecute: (ctx: JobContext) => Promise<JobOutcome>;
const runnerCalls: { type: JobType; opts: RunJobOptions }[] = [];
const fakeRunner = async (type: JobType, opts: RunJobOptions): Promise<RunJobByTypeResult> => {
	runnerCalls.push({ type, opts });
	if (opts.date === '2099-01-01' && !opts.allowOpenWindow) {
		return { status: 'skipped', exitCode: 0, counters: {}, reason: 'window_open' };
	}
	const result = await runJob(
		{ jobs: repos.jobs, logger: createJsonLogger(() => {}), now: () => new Date() },
		{
			job_type: type,
			idempotency_key: `${type}:${opts.date ?? 'slot'}`,
			scheduled_for: new Date().toISOString(),
			trigger: opts.manual ? 'manual' : 'cron',
			force: opts.force ?? false
		},
		(ctx) => {
			opts.onClaimed?.(ctx.run);
			return fakeExecute(ctx);
		}
	);
	return result.status === 'skipped'
		? { status: 'skipped', exitCode: 0, counters: {}, reason: result.reason }
		: { status: result.status, exitCode: 0, counters: {}, runId: result.run_id };
};
vi.mock('./jobs/manual-ingest.server', async (importOriginal) => {
	const original = await importOriginal<typeof import('./jobs/manual-ingest.server')>();
	return { ...original, manualJobRunner: () => fakeRunner };
});

const { actions: reviewActions } = await import('./review/+page.server');
const { actions: editActions } = await import('./events/[id]/+page.server');
const { actions: relationActions } = await import('./relations/+page.server');
const { actions: briefActions } = await import('./briefs/+page.server');
const { actions: jobActions } = await import('./jobs/+page.server');
const { MANUAL_RERUN_MIN_INTERVAL_MS, startManualJob } =
	await import('./jobs/manual-ingest.server');

const ADMIN = { email: 'editor@example.com' };

beforeEach(() => {
	db = openTestDb();
	seedDatabase(db, []);
	repos = createRepositories(db);
	runnerCalls.length = 0;
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
		credibility_level: 'none',
		credibility_reason_th: '',
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
		'category',
		'credibility_level',
		'credibility_reason_th'
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
			credibility_level: current.credibility_level,
			credibility_reason_th: current.credibility_reason_th ?? '',
			change_reason: 'ไม่ได้แก้อะไร'
		});
		expect(result).toMatchObject({ status: 400, data: { message: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' } });
		expect(revisionsFor('demo-evt-13')).toHaveLength(0);
	});

	describe('credibility override', () => {
		const unchanged = () => {
			const row = eventRow('demo-evt-13');
			return Object.fromEntries(EDITABLE.map((name) => [name, row[name] ?? ''])) as Record<
				string,
				string
			>;
		};
		const reason = 'ตัวเลขในรายงานแต่ละแหล่งยังไม่ตรงกัน';

		it('sets the level and reason together in one admin revision', async () => {
			const result = await save({
				...unchanged(),
				credibility_level: 'disputed',
				credibility_reason_th: reason,
				change_reason: 'ปรับป้ายความน่าเชื่อถือ'
			});

			expect(result).toMatchObject({ ok: true });
			expect(eventRow('demo-evt-13')).toMatchObject({
				credibility_level: 'disputed',
				credibility_reason_th: reason
			});
			const revision = revisionsFor('demo-evt-13')[0]!;
			expect(revision.changed_by).toBe(ADMIN.email);
			expect(revision.before_after).toEqual({
				before: { credibility_level: 'none', credibility_reason_th: null },
				after: { credibility_level: 'disputed', credibility_reason_th: reason }
			});
		});

		it('a level-only change writes both keys, and removing the label clears the reason', async () => {
			await save({
				...unchanged(),
				credibility_level: 'unverified',
				credibility_reason_th: reason,
				change_reason: 'ตั้งป้าย'
			});
			const result = await save(
				{ ...unchanged(), credibility_level: 'none', change_reason: 'เอาป้ายออก' },
				loadedFields()
			);

			expect(result).toMatchObject({ ok: true });
			expect(eventRow('demo-evt-13')).toMatchObject({
				credibility_level: 'none',
				credibility_reason_th: null
			});
			expect(Object.keys(revisionsFor('demo-evt-13')[0]!.before_after.after ?? {}).sort()).toEqual([
				'credibility_level',
				'credibility_reason_th'
			]);
		});

		it.each([
			[
				'a URL in the reason',
				{ credibility_reason_th: 'ดูที่ evil.example.com' },
				'credibility_reason_th'
			],
			[
				'contact details in the reason',
				{ credibility_reason_th: 'โทร 081-234-5678' },
				'credibility_reason_th'
			],
			['a reason without Thai', { credibility_reason_th: 'not verified' }, 'credibility_reason_th'],
			['a too long reason', { credibility_reason_th: 'ก'.repeat(301) }, 'credibility_reason_th'],
			['an unknown level', { credibility_level: 'fake' }, 'credibility_level']
		])('rejects %s with a field error', async (_name, overrides, field) => {
			const result = await save({
				...unchanged(),
				credibility_level: 'unverified',
				...overrides,
				change_reason: 'ตั้งป้าย'
			});

			expect(result).toMatchObject({ status: 400, data: { ok: false } });
			const data = (result as { data: { field_errors: Record<string, string> } }).data;
			expect(data.field_errors[field]).toBeTruthy();
			expect(revisionsFor('demo-evt-13')).toHaveLength(0);
		});
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

describe('manual job reruns (runJobByType)', () => {
	it('claims the slot with --force --manual and never starts a running slot twice', async () => {
		let finishFirst!: (outcome: JobOutcome) => void;
		fakeExecute = vi.fn(() => new Promise<JobOutcome>((resolve) => (finishFirst = resolve)));

		expect(await startManualJob('ingest', {}, fakeRunner)).toMatchObject({
			status: 'started',
			run: { idempotency_key: 'ingest:slot', attempts: 1 }
		});
		expect(await startManualJob('ingest', {}, fakeRunner)).toEqual({
			status: 'skipped',
			reason: 'running'
		});
		expect(fakeExecute).toHaveBeenCalledOnce();
		expect(runnerCalls[0]?.opts).toMatchObject({ force: true, manual: true });
		expect(runnerCalls[0]?.opts.allowOpenWindow).toBeUndefined();

		const [run] = await repos.jobs.listRecent(1);
		expect(run).toMatchObject({ job_type: 'ingest', trigger: 'manual', status: 'running' });

		finishFirst({ status: 'succeeded', counters: { sources_ok: 1 }, error: null });
		await vi.waitFor(async () =>
			expect((await repos.jobs.listRecent(1))[0]?.status).toBe('succeeded')
		);
		// Finished slot + force → a new attempt of the same slot (idempotent rerun).
		expect(await startManualJob('ingest', {}, fakeRunner)).toMatchObject({
			status: 'started',
			run: { attempts: 2 }
		});
		finishFirst({ status: 'succeeded', counters: {}, error: null });
	});

	it('reports a refusal before any claim as failed', async () => {
		const usageError = async (): Promise<RunJobByTypeResult> => ({
			status: 'usage_error',
			exitCode: 64,
			counters: {}
		});
		expect(await startManualJob('digest', {}, usageError)).toEqual({
			status: 'failed',
			message: 'usage_error'
		});
	});

	describe('?/rerun action', () => {
		let finish: ((outcome: JobOutcome) => void) | null;
		beforeEach(() => {
			finish = null;
			fakeExecute = () => new Promise<JobOutcome>((resolve) => (finish = resolve));
		});
		afterEach(() => finish?.({ status: 'succeeded', counters: {}, error: null }));

		const rerun = (fields: Record<string, string>) => call(jobActions.rerun, actionEvent(fields));

		it('requires a change_reason and a known job type', async () => {
			expect(await rerun({ job_type: 'ingest' })).toMatchObject({ status: 400 });
			expect(await rerun({ job_type: 'scrape', change_reason: 'ลองดู' })).toMatchObject({
				status: 400
			});
			expect(await repos.admin.listRecentAdminActions('rerun_ingest', 5)).toEqual([]);
		});

		it('starts the run and records the actor and reason, then enforces the interval', async () => {
			expect(await rerun({ job_type: 'ingest', change_reason: 'ฟีดเพิ่งกลับมา' })).toMatchObject({
				ok: true
			});

			const [audit] = await repos.admin.listRecentAdminActions('rerun_ingest', 5);
			expect(audit).toMatchObject({
				action: 'rerun_ingest',
				actor: ADMIN.email,
				reason: 'ฟีดเพิ่งกลับมา',
				target: 'ingest:slot#1'
			});

			finish?.({ status: 'succeeded', counters: {}, error: null });
			const again = await rerun({ job_type: 'ingest', change_reason: 'ลองอีกรอบ' });
			expect(again).toMatchObject({
				status: 429,
				data: { message: expect.stringContaining(`${MANUAL_RERUN_MIN_INTERVAL_MS / 60_000} นาที`) }
			});
			expect(await repos.admin.listRecentAdminActions('rerun_ingest', 5)).toHaveLength(1);
		});

		it('keeps the interval per job type: an ingest rerun does not block digest', async () => {
			expect(await rerun({ job_type: 'ingest', change_reason: 'ฟีดเพิ่งกลับมา' })).toMatchObject({
				ok: true
			});
			finish?.({ status: 'succeeded', counters: {}, error: null });
			expect(await rerun({ job_type: 'digest', change_reason: 'สรุปข่าวใหม่' })).toMatchObject({
				ok: true
			});
			expect(await repos.admin.listRecentAdminActions('rerun_digest', 5)).toMatchObject([
				{ action: 'rerun_digest', target: 'digest:slot#1' }
			]);
		});

		it('passes the date of a brief job and audits the dated slot', async () => {
			const result = await rerun({
				job_type: 'brief_morning',
				date: '2026-11-12',
				change_reason: 'มีข่าวมาช้า'
			});
			expect(result).toMatchObject({ ok: true });
			expect(runnerCalls.at(-1)).toMatchObject({
				type: 'brief_morning',
				opts: { date: '2026-11-12', force: true, manual: true }
			});
			expect(await repos.admin.listRecentAdminActions('rerun_brief_morning', 5)).toMatchObject([
				{ target: 'brief_morning:2026-11-12#1' }
			]);
		});

		it('rejects a malformed date', async () => {
			expect(
				await rerun({ job_type: 'archive_snapshot', date: '12/11/2026', change_reason: 'ลองดู' })
			).toMatchObject({ status: 400 });
			expect(runnerCalls).toEqual([]);
		});

		it('reports window_open for a brief whose window has not closed, and audits nothing', async () => {
			const result = await rerun({
				job_type: 'brief_evening',
				date: '2099-01-01',
				change_reason: 'ลองสร้างล่วงหน้า'
			});
			expect(result).toMatchObject({
				status: 409,
				data: { message: expect.stringContaining('ยังไม่ปิด') }
			});
			expect(await repos.admin.listRecentAdminActions('rerun_brief_evening', 5)).toEqual([]);
		});

		it('reports the real skip reason when the slot is already running', async () => {
			// A cron (or CLI) run holds the claim; no manual start is on record.
			await startManualJob('ingest', {}, fakeRunner);

			const result = await rerun({ job_type: 'ingest', change_reason: 'ลองสั่งรัน' });
			expect(result).toMatchObject({
				status: 409,
				data: { message: expect.stringContaining('กำลังทำงานอยู่') }
			});
			expect(await repos.admin.listRecentAdminActions('rerun_ingest', 5)).toEqual([]);
		});
	});
});
