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
				strict: false,
				dry_run: false,
				fixtures: false
			}
		});
	});

	it('parses flags', () => {
		const parsed = parseJobCliArgs(['ingest', '--fixtures', '--dry-run', '--force', '--manual']);
		expect(parsed).toMatchObject({
			ok: true,
			options: { fixtures: true, dry_run: true, force: true, trigger: 'manual' }
		});
		expect(parseJobCliArgs(['archive_snapshot', '--date', '2026-11-12', '--strict'])).toMatchObject(
			{
				ok: true,
				options: { job_type: 'archive_snapshot', date: '2026-11-12', strict: true }
			}
		);
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
		['--dry-run outside ingest', ['brief_evening', '--dry-run']]
	])('rejects %s', (_name, argv) => {
		expect(parseJobCliArgs(argv)).toMatchObject({ ok: false, error: expect.any(String) });
	});
});
