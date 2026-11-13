/**
 * `npm run job -- <type> [--date YYYY-MM-DD] [--force] [--manual] [--dry-run] [--fixtures] [--max-events N]`
 * Thin CLI over `runJobByType` (src/lib/server/jobs/registry.ts), which builds config, db,
 * repositories, SafeFetch, adapters and the LLM provider (ARCHITECTURE §1, §8). Logs are JSON
 * lines on stdout.
 *
 * Exit codes: 0 succeeded or skipped · 2 partial · 1 failed · 64 usage error.
 *
 * Schedule (UTC; ICT = UTC+7, no DST): production runs it in the `scheduler` container with
 * supercronic, from `docker/crontab` (ARCHITECTURE §8, §17). There the script is bundled to
 * `build/scripts/job.js` and run with plain node, e.g.
 * `docker compose exec scheduler node build/scripts/job.js brief_morning`.
 *
 *   06:00 ICT ingest; digest   `0 23 * * *`      19:00 ICT brief_evening      `0 12 * * *`
 *   07:00 ICT brief_morning    `0 0 * * *`       23:00 ICT ingest; digest     `0 16 * * *`
 *   12:00 ICT ingest; digest   `0 5 * * *`       01:00 ICT archive_snapshot   `0 18 * * *`
 *   18:00 ICT ingest; digest   `0 11 * * *`      (`;` not `&&`: digest still runs when ingest fails)
 *
 * `--fixtures` needs NODE_ENV explicitly development or test (`npm run job` sets development
 * through scripts/dev-tools.env); it is refused in the container.
 * Late reports for a past day: `npm run job -- archive_snapshot --date YYYY-MM-DD --force`.
 * A brief or snapshot asked for before its window closes is refused (skipped, `window_open`,
 * nothing claimed) unless `--force` is given.
 */
import { EXIT_USAGE, parseJobCliArgs, USAGE } from '#lib/server/jobs/cli-args.js';
import { runJobByType } from '#lib/server/jobs/registry.js';

const parsed = parseJobCliArgs(process.argv.slice(2));
if (!parsed.ok) {
	console.error(`job: ${parsed.error}\n${USAGE}`);
	process.exit(EXIT_USAGE);
}

const { options } = parsed;
const result = await runJobByType(options.job_type, {
	date: options.date ?? undefined,
	force: options.force,
	// On the CLI, --force also builds a brief before its window closes (explicit operator choice).
	allowOpenWindow: options.force,
	manual: options.trigger === 'manual',
	dryRun: options.dry_run,
	fixtures: options.fixtures,
	maxEvents: options.max_events ?? undefined
});
process.exitCode = result.exitCode;
