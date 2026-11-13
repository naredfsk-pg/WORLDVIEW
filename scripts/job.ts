/**
 * `npm run job -- <type> [--date YYYY-MM-DD] [--force] [--manual] [--strict] [--dry-run] [--fixtures]`
 * Composition root for CLI jobs (ARCHITECTURE §1, §8): builds config, db, repositories, SafeFetch
 * and adapters, then runs one job. Logs are JSON lines on stdout.
 *
 * Exit codes: 0 succeeded or skipped · 2 partial · 1 failed · 64 usage error.
 *
 * Host crontab (UTC; ICT = UTC+7, no DST). `;` not `&&`, so digest still runs when ingest fails:
 *
 *   # 06:00 ICT ingest + digest
 *   0 23 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 07:00 ICT morning brief
 *   0 0 * * *   cd /srv/worldview && docker compose exec -T app npm run job -- brief_morning
 *   # 12:00 ICT ingest + digest
 *   0 5 * * *   cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 18:00 ICT ingest + digest
 *   0 11 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 19:00 ICT evening brief
 *   0 12 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- brief_evening
 *   # 23:00 ICT ingest + digest
 *   0 16 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 01:00 ICT archive snapshot of the previous Bangkok date
 *   0 18 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- archive_snapshot
 *
 * (`CRON_TZ=Asia/Bangkok` with ICT times is an alternative where the host cron supports it.)
 */
import { fileURLToPath } from 'node:url';
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import {
	EXIT_USAGE,
	parseJobCliArgs,
	USAGE,
	type JobCliOptions
} from '#lib/server/jobs/cli-args.js';
import {
	MAX_ITEM_AGE_HOURS,
	previewIngest,
	runIngest,
	type IngestDeps
} from '#lib/server/jobs/ingest.js';
import { hourlyJobSlot } from '#lib/server/jobs/job-slots.js';
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import {
	exitCodeFor,
	MAX_JOB_DURATION_MS,
	runJob,
	sanitizeError
} from '#lib/server/jobs/runner.js';
import { createFixtureAdapter, createRssAdapter } from '#lib/server/news/adapters.js';
import { allowedHostsFromRegistry, createSafeFetch } from '#lib/server/news/safe-fetch.js';
import { sourceRegistryFor } from '#lib/server/news/sources.js';
import type { Logger } from '#lib/types/jobs.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const logger = createJsonLogger();
const parsed = parseJobCliArgs(process.argv.slice(2));
if (!parsed.ok) {
	console.error(`job: ${parsed.error}\n${USAGE}`);
	process.exit(EXIT_USAGE);
}

try {
	process.exitCode = await main(parsed.options, logger);
} catch (error) {
	// Setup failures (config, database). The message is sanitized; no env values are printed.
	logger.error('job crashed', { job_type: parsed.options.job_type, error: sanitizeError(error) });
	process.exitCode = 1;
}

async function main(options: JobCliOptions, logger: Logger): Promise<number> {
	if (options.job_type !== 'ingest') {
		logger.info('not implemented yet (Wave 2)', {
			job_type: options.job_type,
			strict: options.strict
		});
		return options.strict ? 1 : 0;
	}

	// Fixture runs use their own slot key, but they still write the same database: never into
	// production data.
	if (options.fixtures && !options.dry_run && getConfig().nodeEnv === 'production') {
		logger.error('--fixtures is refused when NODE_ENV=production (use --dry-run)');
		return EXIT_USAGE;
	}

	const sourcesDeps = buildSourceDeps(options.fixtures);
	if (options.dry_run) {
		const outcome = await previewIngest(sourcesDeps, {
			now: () => new Date(),
			logger,
			signal: AbortSignal.timeout(MAX_JOB_DURATION_MS)
		});
		logger.info('dry-run finished', { ...outcome, rss_bytes: process.memoryUsage().rss });
		return outcome.status === 'succeeded' ? 0 : outcome.status === 'partial' ? 2 : 1;
	}

	const db = openDb(getConfig().app.databaseUrl);
	try {
		const repositories = createRepositories(db);
		const now = () => new Date();
		const result = await runJob(
			{ jobs: repositories.jobs, logger, now },
			{
				job_type: 'ingest',
				...hourlyJobSlot('ingest', now(), options.fixtures ? 'fixtures' : null),
				trigger: options.trigger,
				force: options.force
			},
			(ctx) =>
				runIngest({ ...sourcesDeps, ingest: repositories.ingest, digest: repositories.digest }, ctx)
		);
		return exitCodeFor(result);
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
		// The fixture adapter reads local files, so it exists only in --fixtures mode.
		adapters: fixtures
			? { rss: createRssAdapter(), fixture: createFixtureAdapter(REPO_ROOT) }
			: { rss: createRssAdapter() }
	};
}
