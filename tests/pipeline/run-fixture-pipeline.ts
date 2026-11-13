/**
 * Fixture pipeline for the acceptance suite (PRD §11 #3, #4, #6, #11, #12), against the database
 * in DATABASE_URL, through the same job runner as cron (so `job_runs` rows exist and every job
 * logs a JSON "job finished" line with `duration_ms` and `rss_bytes`):
 *
 *   ingest (fixture feeds, no network) → digest (mock LLM, no network)
 *   → brief_morning + brief_evening for 2026-11-13 → archive_snapshot 2026-11-13
 *   → brief_morning for 2026-10-01, a day with no news (partial run with a stored error)
 *   → a forced second ingest + digest, to prove that a rerun adds no rows
 *
 * Runs are forced, so the script can run again on the same database. The last stdout line is
 * `{"pipeline_summary": {...}}` (row counts before/after the rerun, step timings, peak RSS).
 *
 *   DATABASE_URL=file:./data/e2e.db npx tsx tests/pipeline/run-fixture-pipeline.ts
 *
 * Used by tests/e2e/pipeline.e2e.ts and for docs/qa/BASELINE.md.
 */
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { openDb } from '#lib/server/db/client.js';
import { runBrief } from '#lib/server/jobs/briefs.js';
import { runDigest } from '#lib/server/jobs/digest.js';
import { runIngest } from '#lib/server/jobs/ingest.js';
import { archiveJobSlot, briefJobSlot, hourlyJobSlot } from '#lib/server/jobs/job-slots.js';
import { createJsonLogger } from '#lib/server/jobs/logger.js';
import { runJob } from '#lib/server/jobs/runner.js';
import { createDefaultMockHandlers, createMockLlmProvider } from '#lib/server/llm/index.js';
import { createFixtureAdapter } from '#lib/server/news/adapters.js';
import { sourceRegistryFor } from '#lib/server/news/sources.js';

const PIPELINE_BRIEF_DATE = '2026-11-13';
const EMPTY_BRIEF_DATE = '2026-10-01';
const COUNTED_TABLES = ['articles', 'events', 'event_articles', 'event_relations'] as const;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error('run-fixture-pipeline: DATABASE_URL is required');
	process.exit(64);
}

const db = openDb(databaseUrl);
const repositories = createRepositories(db);
const logger = createJsonLogger();
const now = () => new Date();
const steps: Record<string, { status: string; duration_ms: number }> = {};

try {
	await step('ingest', ingest);
	await step('digest', digest);
	await step('brief_morning', () => brief('brief_morning'));
	await step('brief_evening', () => brief('brief_evening'));
	await step('archive_snapshot', snapshot);
	// A day with no news: the run is `partial` and its error is stored in job_runs (PRD §11 #11).
	await step('brief_empty_day', () => brief('brief_morning', EMPTY_BRIEF_DATE));

	const countsBeforeRerun = countRows();
	await step('ingest_rerun', ingest);
	await step('digest_rerun', digest);
	const countsAfterRerun = countRows();

	console.log(
		JSON.stringify({
			pipeline_summary: {
				brief_date: PIPELINE_BRIEF_DATE,
				steps,
				counts_before_rerun: countsBeforeRerun,
				counts_after_rerun: countsAfterRerun,
				// maxRSS is the process peak (kB on every platform Node supports).
				peak_rss_bytes: process.resourceUsage().maxRSS * 1024
			}
		})
	);
} finally {
	db.$client.close();
}

async function step(name: string, run: () => ReturnType<typeof runJob>): Promise<void> {
	const started = performance.now();
	const result = await run();
	steps[name] = { status: result.status, duration_ms: Math.round(performance.now() - started) };
	if (result.status === 'failed' || result.status === 'skipped') {
		throw new Error(`pipeline step ${name} ended ${result.status}`);
	}
}

function ingest() {
	return runJob(
		{ jobs: repositories.jobs, logger, now },
		{
			job_type: 'ingest',
			...hourlyJobSlot('ingest', now(), 'fixtures'),
			trigger: 'manual',
			force: true
		},
		(ctx) =>
			runIngest(
				{
					ingest: repositories.ingest,
					digest: repositories.digest,
					registry: sourceRegistryFor('fixtures'),
					adapters: { fixture: createFixtureAdapter(process.cwd()) },
					safeFetch: async () => {
						throw new Error('the fixture pipeline never uses the network');
					},
					maxItemAgeHours: null
				},
				ctx
			)
	);
}

function digest() {
	return runJob(
		{ jobs: repositories.jobs, logger, now },
		{ job_type: 'digest', ...hourlyJobSlot('digest', now()), trigger: 'manual', force: true },
		(ctx) =>
			runDigest(
				{
					digest: repositories.digest,
					llm: createMockLlmProvider(createDefaultMockHandlers()),
					llmCalls: repositories.llmCalls
				},
				ctx
			)
	);
}

function brief(type: 'brief_morning' | 'brief_evening', date: string = PIPELINE_BRIEF_DATE) {
	return runJob(
		{ jobs: repositories.jobs, logger, now },
		{ job_type: type, ...briefJobSlot(type, date), trigger: 'manual', force: true },
		(ctx) =>
			runBrief({ briefs: repositories.briefs, target: { min: 1, max: 15 } }, ctx, {
				date,
				edition: type === 'brief_morning' ? 'morning' : 'evening'
			})
	);
}

function snapshot() {
	return runJob(
		{ jobs: repositories.jobs, logger, now },
		{
			job_type: 'archive_snapshot',
			...archiveJobSlot(PIPELINE_BRIEF_DATE),
			trigger: 'manual',
			force: true
		},
		(ctx) =>
			runBrief({ briefs: repositories.briefs, target: { min: 1, max: 15 } }, ctx, {
				date: PIPELINE_BRIEF_DATE,
				edition: 'daily_snapshot'
			})
	);
}

function countRows(): Record<string, number> {
	return Object.fromEntries(
		COUNTED_TABLES.map((table) => [
			table,
			(db.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
		])
	);
}
