import { z } from 'zod';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { STALE_RUNNING_CLAIM_MS } from '#lib/server/db/repositories/job-runs.js';
import { DATE_JOBS } from '#lib/server/jobs/cli-args.js';
import type { AdminAction, AdminActionType } from '#lib/types/domain.js';
import { JOB_TYPES, type JobType } from '#lib/types/jobs.js';
import { addDays, isBriefDate, todayBriefDate } from '#lib/utils/date.js';
import {
	changeReason,
	failure,
	firstIssue,
	readForm,
	requireAdmin,
	type AdminActionData
} from '../admin-forms.server';
import {
	MANUAL_RERUN_MIN_INTERVAL_MS,
	manualJobRunner,
	startManualJob,
	type SkipReason
} from './manual-ingest.server';
import type { Actions, PageServerLoad } from './$types';

const RUNS_SHOWN = 30;
const MANUAL_RERUNS_SHOWN = 5;

/** `/admin/jobs`: run history, and per job type whether a claim is live and who reran it recently. */
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const repos = getRepositories();
	const [runs, ...reruns] = await Promise.all([
		repos.jobs.listRecent(RUNS_SHOWN),
		...JOB_TYPES.map((type) =>
			repos.admin.listRecentAdminActions(rerunAction(type), MANUAL_RERUNS_SHOWN)
		)
	]);
	const nowMs = Date.now();
	const jobs = JOB_TYPES.map((type, index) => ({
		job_type: type,
		takes_date: DATE_JOBS.includes(type),
		running: runs.some(
			(run) =>
				run.job_type === type &&
				run.status === 'running' &&
				nowMs - Date.parse(run.started_at) < STALE_RUNNING_CLAIM_MS
		),
		manual_reruns: reruns[index] as AdminAction[]
	}));
	const today = todayBriefDate();
	return { runs, jobs, today, yesterday: addDays(today, -1) };
};

const rerunForm = z.object({
	job_type: z.enum(JOB_TYPES, { error: 'ไม่รู้จักงานนี้' }),
	date: z
		.string()
		.trim()
		.optional()
		.transform((value) => value || undefined),
	change_reason: changeReason
});

const SKIP_MESSAGE: Record<SkipReason, string> = {
	running: 'งานนี้กำลังทำงานอยู่แล้ว ไม่ได้เริ่มซ้ำ',
	already_done: 'งานรอบนี้ทำเสร็จแล้ว ไม่ได้เริ่มใหม่',
	window_open: 'ช่วงเวลาของข่าวในวันที่เลือกยังไม่ปิด จึงยังสร้างสรุปหรือคลังของวันนั้นไม่ได้'
};

export const actions: Actions = {
	/**
	 * `<job_type> --force --manual`, in-process through `runJobByType`. Needs `change_reason`
	 * (and, for brief / archive jobs, an optional date), waits at least
	 * MANUAL_RERUN_MIN_INTERVAL_MS after the previous manual start of the same job type, never
	 * starts a live slot twice (claim), never builds a brief before its window closes, and
	 * records who started it in `admin_actions`.
	 */
	rerun: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const parsed = rerunForm.safeParse(await readForm(request));
		if (!parsed.success) return failure(400, null, firstIssue(parsed.error.issues));
		const { job_type: jobType, change_reason: reason } = parsed.data;
		const takesDate = DATE_JOBS.includes(jobType);
		const date = takesDate ? parsed.data.date : undefined;
		if (date !== undefined && !isBriefDate(date)) {
			return failure(400, null, 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
		}

		const repos = getRepositories();
		const now = new Date();
		const action = rerunAction(jobType);
		const [last] = await repos.admin.listRecentAdminActions(action, 1);
		const waitMs = last
			? Date.parse(last.created_at) + MANUAL_RERUN_MIN_INTERVAL_MS - now.getTime()
			: 0;
		if (waitMs > 0) {
			const minutes = Math.ceil(waitMs / 60_000);
			return failure(
				429,
				null,
				`สั่งรันงานนี้เองได้อีกครั้งในอีก ${minutes} นาที (เว้นอย่างน้อย ${MANUAL_RERUN_MIN_INTERVAL_MS / 60_000} นาทีระหว่างการสั่งรัน)`
			);
		}

		const result = await startManualJob(jobType, { date }, manualJobRunner());
		if (result.status === 'skipped') return failure(409, null, SKIP_MESSAGE[result.reason]);
		if (result.status === 'failed') {
			return failure(500, null, 'เริ่มงานไม่ได้ กรุณาตรวจ log ของเซิร์ฟเวอร์');
		}

		await repos.admin.recordAdminAction({
			created_at: now.toISOString(),
			action,
			actor: admin.email,
			target: `${result.run.idempotency_key}#${result.run.attempts}`,
			reason
		});
		return {
			ok: true,
			message: 'เริ่มงานแล้ว รีเฟรชหน้านี้เพื่อดูสถานะ',
			id: result.run.id,
			reasons: []
		} satisfies AdminActionData;
	}
};

function rerunAction(type: JobType): AdminActionType {
	return `rerun_${type}`;
}
