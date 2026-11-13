import { fail } from '@sveltejs/kit';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { STALE_RUNNING_CLAIM_MS } from '#lib/server/db/repositories/job-runs.js';
import { requireAdmin } from '../admin-forms.server';
import { productionIngestDeps, startManualIngest } from './manual-ingest.server';
import type { Actions, PageServerLoad } from './$types';

const RUNS_SHOWN = 30;

/** `/admin/jobs`: run history and whether an ingest claim is live right now. */
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const runs = await getRepositories().jobs.listRecent(RUNS_SHOWN);
	const nowMs = Date.now();
	const ingestRunning = runs.some(
		(run) =>
			run.job_type === 'ingest' &&
			run.status === 'running' &&
			nowMs - Date.parse(run.started_at) < STALE_RUNNING_CLAIM_MS
	);
	return { runs, ingest_running: ingestRunning };
};

export const actions: Actions = {
	/** `ingest --force --manual`, in-process; the claim keeps a running slot from starting twice. */
	rerunIngest: async ({ locals }) => {
		const admin = requireAdmin(locals);
		const result = await startManualIngest(productionIngestDeps(getRepositories()));
		if (result.status === 'skipped_running') {
			return fail(409, { ok: false, message: 'งานดึงข่าวรอบนี้กำลังทำงานอยู่แล้ว ไม่ได้เริ่มซ้ำ' });
		}
		console.info('[admin] manual ingest started', { by: admin.email });
		return { ok: true, message: 'เริ่มดึงข่าวแล้ว รีเฟรชหน้านี้เพื่อดูสถานะ' };
	}
};
