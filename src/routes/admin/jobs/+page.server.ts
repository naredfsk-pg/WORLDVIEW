import { z } from 'zod';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { STALE_RUNNING_CLAIM_MS } from '#lib/server/db/repositories/job-runs.js';
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
	productionIngestDeps,
	startManualIngest
} from './manual-ingest.server';
import type { Actions, PageServerLoad } from './$types';

const RUNS_SHOWN = 30;
const MANUAL_RERUNS_SHOWN = 5;

/** `/admin/jobs`: run history, whether an ingest claim is live, and who reran it recently. */
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const repos = getRepositories();
	const [runs, manualReruns] = await Promise.all([
		repos.jobs.listRecent(RUNS_SHOWN),
		repos.admin.listRecentAdminActions('rerun_ingest', MANUAL_RERUNS_SHOWN)
	]);
	const nowMs = Date.now();
	const ingestRunning = runs.some(
		(run) =>
			run.job_type === 'ingest' &&
			run.status === 'running' &&
			nowMs - Date.parse(run.started_at) < STALE_RUNNING_CLAIM_MS
	);
	return { runs, ingest_running: ingestRunning, manual_reruns: manualReruns };
};

const rerunForm = z.object({ change_reason: changeReason });

const SKIP_MESSAGE = {
	running: 'งานดึงข่าวรอบนี้กำลังทำงานอยู่แล้ว ไม่ได้เริ่มซ้ำ',
	already_done: 'งานดึงข่าวรอบนี้ทำเสร็จแล้ว ไม่ได้เริ่มใหม่'
} as const;

export const actions: Actions = {
	/**
	 * `ingest --force --manual`, in-process. Needs `change_reason`, waits at least
	 * MANUAL_RERUN_MIN_INTERVAL_MS after the previous manual start, never starts a live slot
	 * twice (claim), and records who started it in `admin_actions`.
	 */
	rerunIngest: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const parsed = rerunForm.safeParse(await readForm(request));
		if (!parsed.success) return failure(400, null, firstIssue(parsed.error.issues));

		const repos = getRepositories();
		const now = new Date();
		const [last] = await repos.admin.listRecentAdminActions('rerun_ingest', 1);
		const waitMs = last
			? Date.parse(last.created_at) + MANUAL_RERUN_MIN_INTERVAL_MS - now.getTime()
			: 0;
		if (waitMs > 0) {
			const minutes = Math.ceil(waitMs / 60_000);
			return failure(
				429,
				null,
				`สั่งรันเองได้อีกครั้งในอีก ${minutes} นาที (เว้นอย่างน้อย ${MANUAL_RERUN_MIN_INTERVAL_MS / 60_000} นาทีระหว่างการสั่งรัน)`
			);
		}

		const result = await startManualIngest(productionIngestDeps(repos));
		if (result.status === 'skipped') return failure(409, null, SKIP_MESSAGE[result.reason]);

		await repos.admin.recordAdminAction({
			created_at: now.toISOString(),
			action: 'rerun_ingest',
			actor: admin.email,
			target: `${result.run.idempotency_key}#${result.run.attempts}`,
			reason: parsed.data.change_reason
		});
		return {
			ok: true,
			message: 'เริ่มดึงข่าวแล้ว รีเฟรชหน้านี้เพื่อดูสถานะ',
			id: result.run.id,
			reasons: []
		} satisfies AdminActionData;
	}
};
