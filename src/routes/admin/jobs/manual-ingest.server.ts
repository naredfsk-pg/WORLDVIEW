/**
 * Manual job reruns from `/admin/jobs`, started in-process through `runJobByType`
 * (src/lib/server/jobs/registry.ts), the same entry point as `npm run job -- <type> --force
 * --manual`. The claim keeps a slot that is already `running` (cron or another click) from
 * starting twice. A forced admin rerun never builds a brief or snapshot before its window closes
 * (`allowOpenWindow` is not set), so a start can be refused as `running`, `already_done` or
 * `window_open`.
 *
 * (The file keeps its Wave 2 name; it now starts every job type, not only ingest.)
 */
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import {
	runJobByType,
	type RunJobByTypeResult,
	type RunJobOptions
} from '#lib/server/jobs/registry.js';
import { sanitizeError } from '#lib/server/jobs/runner.js';
import type { JobRun, JobType } from '#lib/types/jobs.js';

/** Minimum time between two manual reruns of the same job type (any admin), from the last start. */
export const MANUAL_RERUN_MIN_INTERVAL_MS = 5 * 60 * 1000;

export const SKIP_REASONS = ['running', 'already_done', 'window_open'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

type ClaimedRun = Pick<JobRun, 'id' | 'idempotency_key' | 'attempts'>;

export type ManualStartResult =
	| { status: 'started'; run: ClaimedRun }
	| { status: 'skipped'; reason: SkipReason }
	| { status: 'failed'; message: string };

export type JobRunner = (type: JobType, opts: RunJobOptions) => Promise<RunJobByTypeResult>;

/** The production runner; tests replace this export. */
export function manualJobRunner(): JobRunner {
	return runJobByType;
}

/**
 * Claims the slot of `type` with `force` + `manual` and returns as soon as the claim is decided;
 * the job itself keeps running in the background (20-minute abort from `runJob`).
 */
export async function startManualJob(
	type: JobType,
	options: { date?: string },
	runner: JobRunner
): Promise<ManualStartResult> {
	let markClaimed!: (run: ClaimedRun) => void;
	const claimed = new Promise<ClaimedRun>((resolve) => (markClaimed = resolve));

	const finished = runner(type, {
		date: options.date,
		force: true,
		manual: true,
		onClaimed: (run) => markClaimed(run)
	});

	const first = await Promise.race([claimed.then((run) => ({ run })), finished]);
	if ('run' in first) {
		finished.catch((error: unknown) =>
			createJsonLogger().error('manual job crashed', {
				job_type: type,
				error: sanitizeError(error)
			})
		);
		const { id, idempotency_key, attempts } = first.run;
		return { status: 'started', run: { id, idempotency_key, attempts } };
	}
	if (first.status === 'skipped' && isSkipReason(first.reason)) {
		return { status: 'skipped', reason: first.reason };
	}
	// Refused before any claim: a usage error, or config / database setup failed.
	return { status: 'failed', message: first.status };
}

function isSkipReason(value: string | undefined): value is SkipReason {
	return (SKIP_REASONS as readonly (string | undefined)[]).includes(value);
}
