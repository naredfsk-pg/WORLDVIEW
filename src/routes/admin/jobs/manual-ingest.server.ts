/**
 * Manual `ingest` rerun from `/admin/jobs`, started in-process: the same as
 * `npm run job -- ingest --force --manual` (scripts/job.ts), with the same claim, so a slot that
 * is already `running` (cron or another click) is never started twice.
 *
 * FOLLOW-UP (after the digest lane merges): replace this composition with
 * `runJobByType` from `src/lib/server/jobs/registry.ts` and enable the other job types.
 */
import { MAX_ITEM_AGE_HOURS, runIngest } from '#lib/server/jobs/ingest.js';
import { hourlyJobSlot } from '#lib/server/jobs/job-slots.js';
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import { runJob, sanitizeError, type RunJobDeps } from '#lib/server/jobs/runner.js';
import { createRssAdapter } from '#lib/server/news/adapters.js';
import { allowedHostsFromRegistry, createSafeFetch } from '#lib/server/news/safe-fetch.js';
import { sourceRegistryFor } from '#lib/server/news/sources.js';
import type { JobContext, JobOutcome } from '#lib/types/jobs.js';
import type { Repositories } from '#lib/types/repositories.js';

export type ManualStartResult = { status: 'started' } | { status: 'skipped_running' };

export interface ManualIngestDeps extends RunJobDeps {
	execute: (ctx: JobContext) => Promise<JobOutcome>;
}

/**
 * Claims the current hourly slot with `force` + `manual` and returns as soon as the claim is
 * decided; the job itself keeps running in the background (20-minute abort from `runJob`).
 */
export async function startManualIngest(deps: ManualIngestDeps): Promise<ManualStartResult> {
	let markStarted!: () => void;
	const started = new Promise<'started'>((resolve) => (markStarted = () => resolve('started')));

	const run = runJob(
		deps,
		{
			job_type: 'ingest',
			...hourlyJobSlot('ingest', deps.now()),
			trigger: 'manual',
			force: true
		},
		(ctx) => {
			markStarted();
			return deps.execute(ctx);
		}
	);

	const first = await Promise.race([started, run]);
	if (first === 'started') {
		run.catch((error: unknown) =>
			deps.logger.error('manual ingest crashed', { error: sanitizeError(error) })
		);
		return { status: 'started' };
	}
	// `force` never steals a live claim, so the only skip left is "running".
	return { status: 'skipped_running' };
}

/** The production ingest composition (registry, SafeFetch allowlist, RSS adapter), as in scripts/job.ts. */
export function productionIngestDeps(repositories: Repositories): ManualIngestDeps {
	const registry = sourceRegistryFor('production');
	const ingestDeps = {
		registry,
		maxItemAgeHours: MAX_ITEM_AGE_HOURS,
		safeFetch: createSafeFetch({ allowedHosts: allowedHostsFromRegistry(registry) }),
		adapters: { rss: createRssAdapter() },
		ingest: repositories.ingest,
		digest: repositories.digest
	};
	return {
		jobs: repositories.jobs,
		logger: createJsonLogger(),
		now: () => new Date(),
		execute: (ctx) => runIngest(ingestDeps, ctx)
	};
}
