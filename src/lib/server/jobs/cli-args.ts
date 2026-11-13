/**
 * Parses `npm run job -- <type> [--date YYYY-MM-DD] [--force] [--manual] [--strict]
 * [--dry-run] [--fixtures]` (ARCHITECTURE §8). Usage errors map to exit code 64.
 */
import { parseArgs } from 'node:util';
import { JOB_TYPES, type JobCliArgs, type JobType } from '#lib/types/jobs.js';

export const USAGE = `usage: npm run job -- <${JOB_TYPES.join('|')}> [--date YYYY-MM-DD] [--force] [--manual] [--strict]
       npm run job -- ingest [--fixtures] [--dry-run] [--force] [--manual]`;
export const EXIT_USAGE = 64;

export interface JobCliOptions extends JobCliArgs {
	/** ingest only: fetch + normalize, no database access at all. */
	dry_run: boolean;
	/** ingest only: use the fixture sources under tests/fixtures/feeds (no network). */
	fixtures: boolean;
	/** Exit non-zero when the job type is not implemented yet. */
	strict: boolean;
}

export type ParsedJobCli = { ok: true; options: JobCliOptions } | { ok: false; error: string };

const DATE_JOBS: readonly JobType[] = ['brief_morning', 'brief_evening', 'archive_snapshot'];

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
				strict: { type: 'boolean', default: false },
				'dry-run': { type: 'boolean', default: false },
				fixtures: { type: 'boolean', default: false }
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
	if (date !== null && !isCalendarDate(date)) {
		return { ok: false, error: `--date must be a real YYYY-MM-DD date, got "${date}"` };
	}
	if ((values['dry-run'] || values.fixtures) && jobType !== 'ingest') {
		return { ok: false, error: '--dry-run and --fixtures apply only to ingest' };
	}

	return {
		ok: true,
		options: {
			job_type: jobType,
			date,
			force: values.force,
			trigger: values.manual ? 'manual' : 'cron',
			strict: values.strict,
			dry_run: values['dry-run'],
			fixtures: values.fixtures
		}
	};
}

function isJobType(value: string): value is JobType {
	return (JOB_TYPES as readonly string[]).includes(value);
}

/** `YYYY-MM-DD` that is a real calendar day (rejects 2026-02-30). */
function isCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}
