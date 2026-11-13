import { describe, expect, it } from 'vitest';
import { parseJobCliArgs } from './cli-args';

describe('parseJobCliArgs', () => {
	it('parses a cron ingest with defaults', () => {
		expect(parseJobCliArgs(['ingest'])).toEqual({
			ok: true,
			options: {
				job_type: 'ingest',
				date: null,
				force: false,
				trigger: 'cron',
				dry_run: false,
				fixtures: false,
				max_events: null
			}
		});
	});

	it('parses flags', () => {
		const parsed = parseJobCliArgs(['ingest', '--fixtures', '--dry-run', '--force', '--manual']);
		expect(parsed).toMatchObject({
			ok: true,
			options: { fixtures: true, dry_run: true, force: true, trigger: 'manual' }
		});
		expect(parseJobCliArgs(['archive_snapshot', '--date', '2026-11-12'])).toMatchObject({
			ok: true,
			options: { job_type: 'archive_snapshot', date: '2026-11-12' }
		});
		expect(parseJobCliArgs(['digest', '--max-events', '3'])).toMatchObject({
			ok: true,
			options: { job_type: 'digest', max_events: 3 }
		});
		expect(parseJobCliArgs(['reevaluate_pending', '--dry-run'])).toMatchObject({
			ok: true,
			options: { job_type: 'reevaluate_pending', dry_run: true, fixtures: false }
		});
	});

	it.each([
		['no job type', []],
		['two job types', ['ingest', 'digest']],
		['an unknown job type', ['scrape']],
		['an unknown flag', ['ingest', '--yolo']],
		['--date on an hourly job', ['ingest', '--date', '2026-11-12']],
		['a malformed date', ['brief_morning', '--date', '13/11/2026']],
		['an impossible date', ['brief_morning', '--date', '2026-02-30']],
		['--fixtures outside ingest', ['digest', '--fixtures']],
		['--dry-run outside ingest and reevaluate_pending', ['brief_evening', '--dry-run']],
		['--fixtures on reevaluate_pending', ['reevaluate_pending', '--fixtures']],
		['--date on reevaluate_pending', ['reevaluate_pending', '--date', '2026-11-12']],
		['a date before 1970', ['archive_snapshot', '--date', '1969-12-31']],
		['--max-events outside digest', ['ingest', '--max-events', '3']],
		['--max-events 0', ['digest', '--max-events', '0']],
		['a fractional --max-events', ['digest', '--max-events', '1.5']],
		['the removed --strict flag', ['digest', '--strict']]
	])('rejects %s', (_name, argv) => {
		expect(parseJobCliArgs(argv)).toMatchObject({ ok: false, error: expect.any(String) });
	});
});
