/**
 * `runJobByType`: the one entry point for running a job, shared by `scripts/job.ts` (CLI) and the
 * admin lane. It is the jobs composition root (ARCHITECTURE §8): the only file under
 * `server/jobs` that reads config and opens the concrete database; every job body still sees
 * repository interfaces only. Each call opens its own connection (WAL) and closes it at the end.
 *
 * Never throws: setup failures (config, database) come back as `failed` / exit code 1, usage
 * errors as `usage_error` / 64. Logs are JSON lines on stdout without secrets.
 */
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import type { BriefEdition } from '#lib/types/domain.js';
import type { JobContext, JobOutcome, JobRun, JobType } from '#lib/types/jobs.js';
import type { Repositories } from '#lib/types/repositories.js';
import { addDays, isBriefDate, todayBriefDate } from '#lib/utils/date.js';
import { createLlmProviderFromConfig } from '../llm/index.js';
import { createFixtureAdapter, createRssAdapter } from '../news/adapters.js';
import { allowedHostsFromRegistry, createSafeFetch } from '../news/safe-fetch.js';
import { sourceRegistryFor } from '../news/sources.js';
import { briefWindow, runBrief } from './briefs.js';
import { DATE_JOBS, EXIT_USAGE } from './cli-args.js';
import { runDigest } from './digest.js';
import { runReevaluatePending } from './reevaluate.js';
import { MAX_ITEM_AGE_HOURS, previewIngest, runIngest, type IngestDeps } from './ingest.js';
import { archiveJobSlot, briefJobSlot, hourlyJobSlot, type JobSlot } from './job-slots.js';
import { createJsonLogger } from './logger.js';
import { exitCodeFor, MAX_JOB_DURATION_MS, runJob, sanitizeError } from './runner.js';

export interface RunJobOptions {
	/** brief_* / archive_snapshot: Bangkok date. Default: today / yesterday (ARCHITECTURE §8). */
	date?: string;
	/** Re-run a slot that already succeeded. */
	force?: boolean;
	/** trigger "manual" instead of "cron". */
	manual?: boolean;
	/**
	 * ingest: fetch + normalize without any database access. reevaluate_pending: read and log the
	 * planned decisions, write nothing (no job_runs claim either).
	 */
	dryRun?: boolean;
	/** ingest only: the fictional fixture feeds (refused in production unless dryRun). */
	fixtures?: boolean;
	/** digest only: content for at most N events. */
	maxEvents?: number;
	signal?: AbortSignal;
	/**
	 * brief_* / archive_snapshot: build even before the window closes. The CLI sets it with
	 * `--force`; the admin page never does (a forced admin rerun still respects the window).
	 */
	allowOpenWindow?: boolean;
	/**
	 * Called once the slot is claimed, before the job body runs, so a caller (the admin page)
	 * can answer right away and let the job finish in the background.
	 */
	onClaimed?: (run: Pick<JobRun, 'id' | 'idempotency_key' | 'attempts'>) => void;
}

export interface RunJobByTypeResult {
	/** succeeded · partial · failed · skipped · usage_error */
	status: string;
	exitCode: number;
	counters: Record<string, number>;
	runId?: string;
	/**
	 * Why a run was skipped: `already_done` / `running` (slot taken), or `window_open` (a brief or
	 * snapshot asked for before its window closed, without `allowOpenWindow`; nothing is claimed).
	 */
	reason?: string;
}

const BRIEF_EDITION_BY_JOB = {
	brief_morning: 'morning',
	brief_evening: 'evening',
	archive_snapshot: 'daily_snapshot'
} as const satisfies Partial<Record<JobType, BriefEdition>>;

export async function runJobByType(
	type: JobType,
	opts: RunJobOptions = {}
): Promise<RunJobByTypeResult> {
	const logger = createJsonLogger();
	const usageError = findUsageError(type, opts);
	if (usageError) {
		logger.error('job usage error', { job_type: type, error: usageError });
		return { status: 'usage_error', exitCode: EXIT_USAGE, counters: {} };
	}

	try {
		const config = getConfig();
		if (opts.fixtures && !opts.dryRun && !config.devToolsAllowed) {
			// Fixture runs use their own slot key, but they would still write the production database.
			// Allowlist: NODE_ENV must be explicitly development or test (unset refuses too).
			logger.error('--fixtures needs NODE_ENV=development or test (use --dry-run to preview)');
			return { status: 'usage_error', exitCode: EXIT_USAGE, counters: {} };
		}
		if (type === 'ingest' && opts.dryRun) return await dryRunIngest(opts, logger);
		if (type === 'reevaluate_pending' && opts.dryRun) return await dryRunReevaluate(logger);

		// A brief built before its window closes would take the day's slot with half the news, and
		// the real cron run would then be `already_done`. Refuse before claiming anything.
		const open = openBriefWindow(type, opts, new Date());
		if (open) {
			logger.warn('job skipped: window still open', { job_type: type, ...open });
			return { status: 'skipped', exitCode: 0, counters: {}, reason: 'window_open' };
		}

		const db = openDb(config.app.databaseUrl);
		try {
			const repositories = createRepositories(db);
			const now = () => new Date();
			const plan = planJob(type, opts, repositories, now());
			const result = await runJob(
				{ jobs: repositories.jobs, logger, now, signal: opts.signal },
				{
					job_type: type,
					...plan.slot,
					trigger: opts.manual ? 'manual' : 'cron',
					force: opts.force ?? false
				},
				(ctx) => {
					opts.onClaimed?.(ctx.run);
					return plan.execute(ctx);
				}
			);
			return {
				status: result.status,
				exitCode: exitCodeFor(result),
				...(result.status === 'skipped'
					? { counters: {}, reason: result.reason }
					: { counters: { ...result.counters }, runId: result.run_id })
			};
		} finally {
			db.$client.close();
		}
	} catch (error) {
		logger.error('job crashed', { job_type: type, error: sanitizeError(error) });
		return { status: 'failed', exitCode: 1, counters: {} };
	}
}

function findUsageError(type: JobType, opts: RunJobOptions): string | null {
	if (opts.date !== undefined && !DATE_JOBS.includes(type)) {
		return `date applies only to ${DATE_JOBS.join(', ')}`;
	}
	if (opts.date !== undefined && !isBriefDate(opts.date)) return 'date must be a real YYYY-MM-DD';
	if (opts.fixtures && type !== 'ingest') return 'fixtures applies only to ingest';
	if (opts.dryRun && type !== 'ingest' && type !== 'reevaluate_pending') {
		return 'dryRun applies only to ingest and reevaluate_pending';
	}
	if (opts.maxEvents !== undefined) {
		if (type !== 'digest') return 'maxEvents applies only to digest';
		if (!Number.isSafeInteger(opts.maxEvents) || opts.maxEvents < 1) {
			return 'maxEvents must be a positive integer';
		}
	}
	return null;
}

/** The slot to claim and the job body to run for `type`. */
function planJob(
	type: JobType,
	opts: RunJobOptions,
	repositories: Repositories,
	now: Date
): {
	slot: JobSlot;
	execute: (ctx: JobContext) => Promise<JobOutcome>;
} {
	const config = getConfig();
	if (type === 'ingest') {
		const sources = buildSourceDeps(opts.fixtures ?? false);
		return {
			slot: hourlyJobSlot('ingest', now, opts.fixtures ? 'fixtures' : null),
			execute: (ctx) =>
				runIngest(
					{
						...sources,
						ingest: repositories.ingest,
						digest: repositories.digest,
						maxNewItemsPerSource: config.ingest.maxNewItemsPerSource
					},
					ctx
				)
		};
	}
	if (type === 'digest') {
		return {
			slot: hourlyJobSlot('digest', now),
			execute: (ctx) =>
				runDigest(
					{
						digest: repositories.digest,
						llm: createLlmProviderFromConfig(config.llm, repositories.llmCalls, {
							log: (entry) => ctx.logger.info('llm call', { ...entry })
						}),
						llmCalls: repositories.llmCalls,
						maxEvents: opts.maxEvents,
						autoPublish: config.editorial.autoPublish,
						relationMinConfidence: config.editorial.relationsMinConfidence
					},
					ctx
				)
		};
	}

	if (type === 'reevaluate_pending') {
		return {
			slot: hourlyJobSlot('reevaluate_pending', now),
			execute: (ctx) =>
				runReevaluatePending(
					{
						reevaluation: repositories.reevaluation,
						autoPublish: config.editorial.autoPublish,
						relationMinConfidence: config.editorial.relationsMinConfidence,
						dryRun: false
					},
					ctx
				)
		};
	}

	const edition = BRIEF_EDITION_BY_JOB[type];
	const date = briefDateFor(type, opts, now);
	return {
		slot: type === 'archive_snapshot' ? archiveJobSlot(date) : briefJobSlot(type, date),
		execute: (ctx) =>
			runBrief(
				{
					briefs: repositories.briefs,
					target: { min: config.app.dailyEventTargetMin, max: config.app.dailyEventTargetMax }
				},
				ctx,
				{ date, edition }
			)
	};
}

/** brief_* default to today's Bangkok date, archive_snapshot to the previous one (§8). */
function briefDateFor(
	type: keyof typeof BRIEF_EDITION_BY_JOB,
	opts: RunJobOptions,
	now: Date
): string {
	const today = todayBriefDate(now);
	return opts.date ?? (type === 'archive_snapshot' ? addDays(today, -1) : today);
}

/** The window of a brief / snapshot job that has not closed yet (and no `allowOpenWindow`), else null. */
function openBriefWindow(
	type: JobType,
	opts: RunJobOptions,
	now: Date
): { date: string; window_end_utc: string } | null {
	if (opts.allowOpenWindow || !(type in BRIEF_EDITION_BY_JOB)) return null;
	const briefType = type as keyof typeof BRIEF_EDITION_BY_JOB;
	const date = briefDateFor(briefType, opts, now);
	const window = briefWindow(date, BRIEF_EDITION_BY_JOB[briefType]);
	return now.toISOString() < window.end_utc ? { date, window_end_utc: window.end_utc } : null;
}

async function dryRunIngest(
	opts: RunJobOptions,
	logger: ReturnType<typeof createJsonLogger>
): Promise<RunJobByTypeResult> {
	const timeout = AbortSignal.timeout(MAX_JOB_DURATION_MS);
	const outcome = await previewIngest(buildSourceDeps(opts.fixtures ?? false), {
		now: () => new Date(),
		logger,
		signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
	});
	logger.info('dry-run finished', { ...outcome, rss_bytes: process.memoryUsage().rss });
	const exitCode = outcome.status === 'succeeded' ? 0 : outcome.status === 'partial' ? 2 : 1;
	return { status: outcome.status, exitCode, counters: { ...outcome.counters } };
}

/**
 * `reevaluate_pending --dry-run`: the same planning on the real database, but nothing is written
 * and no slot is claimed, so it can run any number of times before the real run.
 */
async function dryRunReevaluate(
	logger: ReturnType<typeof createJsonLogger>
): Promise<RunJobByTypeResult> {
	const config = getConfig();
	const db = openDb(config.app.databaseUrl);
	try {
		const outcome = await runReevaluatePending(
			{
				reevaluation: createRepositories(db).reevaluation,
				autoPublish: config.editorial.autoPublish,
				relationMinConfidence: config.editorial.relationsMinConfidence,
				dryRun: true
			},
			{ now: () => new Date(), logger, signal: AbortSignal.timeout(MAX_JOB_DURATION_MS) }
		);
		logger.info('dry-run finished', {
			job_type: 'reevaluate_pending',
			policy: config.editorial.autoPublish,
			status: outcome.status,
			counters: { ...outcome.counters }
		});
		const exitCode = outcome.status === 'succeeded' ? 0 : outcome.status === 'partial' ? 2 : 1;
		return { status: outcome.status, exitCode, counters: { ...outcome.counters } };
	} finally {
		db.$client.close();
	}
}

/** Registry, SafeFetch (allowlist from the enabled registry hosts) and the adapters for this mode. */
function buildSourceDeps(
	fixtures: boolean
): Pick<IngestDeps, 'registry' | 'adapters' | 'safeFetch' | 'maxItemAgeHours'> {
	const registry = sourceRegistryFor(fixtures ? 'fixtures' : 'production');
	return {
		registry,
		// The fixture feeds have fixed dates, so the max item age would drop them all after 3 days.
		maxItemAgeHours: fixtures ? null : MAX_ITEM_AGE_HOURS,
		safeFetch: createSafeFetch({ allowedHosts: allowedHostsFromRegistry(registry) }),
		// The fixture adapter reads local files (paths relative to the repo root, the cwd of every
		// npm script and of the app container), so it exists only in fixtures mode.
		adapters: fixtures
			? { rss: createRssAdapter(), fixture: createFixtureAdapter(process.cwd()) }
			: { rss: createRssAdapter() }
	};
}
