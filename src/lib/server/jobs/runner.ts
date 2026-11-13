/**
 * Job lifecycle (ARCHITECTURE §8): claim the idempotency key, run the job body with a
 * `JobContext` (fake-able clock, logger, 20-minute abort signal), then finish with the claim
 * token. Jobs never auto-retry themselves; the next slot or a manual `--force` rerun does.
 */
import type {
	ClaimJobInput,
	JobContext,
	JobCounters,
	JobOutcome,
	Logger
} from '#lib/types/jobs.js';
import type { JobRunRepository } from '#lib/types/repositories.js';

/** Jobs abort themselves after this long (`JobContext.signal`). */
export const MAX_JOB_DURATION_MS = 20 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

export interface RunJobDeps {
	jobs: JobRunRepository;
	logger: Logger;
	now: () => Date;
	maxDurationMs?: number;
}

export type RunJobResult =
	| { status: 'skipped'; reason: 'already_done' | 'running' }
	| {
			status: JobOutcome['status'];
			run_id: string;
			counters: JobCounters;
			/** False when a newer claim took the slot over before this run finished. */
			finish_recorded: boolean;
	  };

export async function runJob(
	deps: RunJobDeps,
	claim: Omit<ClaimJobInput, 'now'>,
	execute: (ctx: JobContext) => Promise<JobOutcome>
): Promise<RunJobResult> {
	const { logger } = deps;
	const claimed = await deps.jobs.claim({ ...claim, now: deps.now().toISOString() });
	if (!claimed.claimed) {
		logger.info('job skipped', {
			job_type: claim.job_type,
			idempotency_key: claim.idempotency_key,
			reason: claimed.reason,
			existing_status: claimed.existing.status
		});
		return { status: 'skipped', reason: claimed.reason };
	}

	const { run } = claimed;
	const startedMs = deps.now().getTime();
	logger.info('job started', {
		job_type: run.job_type,
		idempotency_key: run.idempotency_key,
		run_id: run.id,
		attempt: run.attempts,
		trigger: run.trigger
	});

	const signal = AbortSignal.timeout(deps.maxDurationMs ?? MAX_JOB_DURATION_MS);
	let outcome: JobOutcome;
	try {
		outcome = await execute({ run, now: deps.now, logger, signal });
	} catch (error) {
		outcome = { status: 'failed', counters: {}, error: sanitizeError(error) };
	}

	const finishRecorded = await deps.jobs.finish(
		run.id,
		run.attempts,
		outcome,
		deps.now().toISOString()
	);
	const summary = {
		job_type: run.job_type,
		idempotency_key: run.idempotency_key,
		run_id: run.id,
		attempt: run.attempts,
		status: outcome.status,
		counters: outcome.counters,
		error: outcome.error,
		duration_ms: deps.now().getTime() - startedMs,
		rss_bytes: process.memoryUsage().rss,
		finish_recorded: finishRecorded
	};
	if (!finishRecorded) logger.warn('job finished after its claim was taken over', summary);
	else if (outcome.status === 'succeeded') logger.info('job finished', summary);
	else logger.warn('job finished', summary);

	return {
		status: outcome.status,
		run_id: run.id,
		counters: outcome.counters,
		finish_recorded: finishRecorded
	};
}

/** CLI exit codes (§8): 0 succeeded or skipped · 2 partial · 1 failed. */
export function exitCodeFor(result: RunJobResult): number {
	if (result.status === 'skipped' || result.status === 'succeeded') return 0;
	return result.status === 'partial' ? 2 : 1;
}

/** Short, single-line error text for `job_runs.error` and logs (no stacks, no bodies). */
export function sanitizeError(error: unknown): string {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
	return message.replace(/\s+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}
