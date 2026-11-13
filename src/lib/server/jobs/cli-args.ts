/**
 * Parses `npm run job -- <type> [--date YYYY-MM-DD] [--force] [--manual] [--dry-run] [--fixtures]
 * [--max-events N]` (ARCHITECTURE §8). `--dry-run` applies to ingest and reevaluate_pending.
 * Usage errors map to exit code 64.
 */
import { parseArgs } from 'node:util';
import { JOB_TYPES, type JobCliArgs, type JobType } from '#lib/types/jobs.js';
import { isBriefDate } from '#lib/utils/date.js';

export const USAGE = `usage: npm run job -- <${JOB_TYPES.join('|')}> [--force] [--manual]
       npm run job -- <brief_morning|brief_evening|archive_snapshot> [--date YYYY-MM-DD]
       npm run job -- ingest [--fixtures] [--dry-run]
       npm run job -- digest [--max-events N]
       npm run job -- reevaluate_pending [--dry-run]`;
export const EXIT_USAGE = 64;

export interface JobCliOptions extends JobCliArgs {
	/** ingest: fetch + normalize, no database access at all; reevaluate_pending: plan, no writes. */
	dry_run: boolean;
	/** ingest only: use the fixture sources under tests/fixtures/feeds (no network). */
	fixtures: boolean;
	/** digest only: give content to at most N events (bounded smoke runs). */
	max_events: number | null;
}

export type ParsedJobCli = { ok: true; options: JobCliOptions } | { ok: false; error: string };

export const DATE_JOBS: readonly JobType[] = ['brief_morning', 'brief_evening', 'archive_snapshot'];

export function parseJobCliArgs(argv: string[]): ParsedJobCli {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			strict: true,
			options: {
				date: { type: 'string' },
				force: { type: 'boolean', default: false },
				manual: { type: 'boolean', default: false },
				'dry-run': { type: 'boolean', default: false },
				fixtures: { type: 'boolean', default: false },
				'max-events': { type: 'string' }
			}
		});
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'invalid arguments' };
	}

	const { values, positionals } = parsed;
	if (positionals.length !== 1) return { ok: false, error: 'expected exactly one job type' };
	const jobType = positionals[0]!;
	if (!isJobType(jobType)) return { ok: false, error: `unknown job type "${jobType}"` };

	const date = values.date ?? null;
	if (date !== null && !DATE_JOBS.includes(jobType)) {
		return { ok: false, error: `--date applies only to ${DATE_JOBS.join(', ')}` };
	}
	if (date !== null && !isBriefDate(date)) {
		return { ok: false, error: `--date must be a real YYYY-MM-DD date, got "${date}"` };
	}
	if (values.fixtures && jobType !== 'ingest') {
		return { ok: false, error: '--fixtures applies only to ingest' };
	}
	if (values['dry-run'] && jobType !== 'ingest' && jobType !== 'reevaluate_pending') {
		return { ok: false, error: '--dry-run applies only to ingest and reevaluate_pending' };
	}

	const rawMaxEvents = values['max-events'];
	if (rawMaxEvents !== undefined && jobType !== 'digest') {
		return { ok: false, error: '--max-events applies only to digest' };
	}
	const maxEvents = rawMaxEvents === undefined ? null : Number(rawMaxEvents);
	if (maxEvents !== null && !(Number.isSafeInteger(maxEvents) && maxEvents >= 1)) {
		return { ok: false, error: `--max-events must be a positive integer, got "${rawMaxEvents}"` };
	}

	return {
		ok: true,
		options: {
			job_type: jobType,
			date,
			force: values.force,
			trigger: values.manual ? 'manual' : 'cron',
			dry_run: values['dry-run'],
			fixtures: values.fixtures,
			max_events: maxEvents
		}
	};
}

function isJobType(value: string): value is JobType {
	return (JOB_TYPES as readonly string[]).includes(value);
}
