/**
 * `npm run job -- <type> [--date YYYY-MM-DD] [--force] [--manual] [--dry-run] [--fixtures] [--max-events N]`
 * Thin CLI over `runJobByType` (src/lib/server/jobs/registry.ts), which builds config, db,
 * repositories, SafeFetch, adapters and the LLM provider (ARCHITECTURE §1, §8). Logs are JSON
 * lines on stdout.
 *
 * Exit codes: 0 succeeded or skipped · 2 partial · 1 failed · 64 usage error.
 *
 * Host crontab (UTC; ICT = UTC+7, no DST). `;` not `&&`, so digest still runs when ingest fails:
 *
 *   # 06:00 ICT ingest + digest
 *   0 23 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 07:00 ICT morning brief (today's Bangkok date)
 *   0 0 * * *   cd /srv/worldview && docker compose exec -T app npm run job -- brief_morning
 *   # 12:00 ICT ingest + digest
 *   0 5 * * *   cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 18:00 ICT ingest + digest
 *   0 11 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 19:00 ICT evening brief (today's Bangkok date)
 *   0 12 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- brief_evening
 *   # 23:00 ICT ingest + digest
 *   0 16 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- ingest; docker compose exec -T app npm run job -- digest
 *   # 01:00 ICT archive snapshot of the previous Bangkok date
 *   0 18 * * *  cd /srv/worldview && docker compose exec -T app npm run job -- archive_snapshot
 *
 * (`CRON_TZ=Asia/Bangkok` with ICT times is an alternative where the host cron supports it.)
 * Late reports for a past day: `npm run job -- archive_snapshot --date YYYY-MM-DD --force`.
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
	manual: options.trigger === 'manual',
	dryRun: options.dry_run,
	fixtures: options.fixtures,
	maxEvents: options.max_events ?? undefined
});
process.exitCode = result.exitCode;
