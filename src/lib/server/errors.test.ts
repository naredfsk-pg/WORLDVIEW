import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { jobRuns } from './db/schema';
import { openTestDb } from './db/test-db';
import { sanitizeErrorMessage } from './errors';
import { sanitizeError } from './jobs/runner';

const SECRET = 'secret-llm-output-or-excerpt';

/**
 * Real errors from a failing insert on the app's driver. With synchronous better-sqlite3, a
 * builder query throws the driver's `SqliteError` as is, and `db.run(sql…)` wraps it in a
 * `DrizzleError` whose message is the SQL text. `DrizzleQueryError` (SQL text plus the bound
 * params) comes from Drizzle's async drivers; it is built here from the real driver error.
 */
function realQueryErrors(): { builder: unknown; raw: unknown; withParams: DrizzleQueryError } {
	const db = openTestDb();
	const row = {
		id: 'run-1',
		job_type: 'ingest',
		idempotency_key: 'ingest:2026-11-13T06',
		scheduled_for: '2026-11-13T06:00:00.000Z',
		trigger: 'cron',
		attempts: 1,
		started_at: '2026-11-13T06:00:00.000Z',
		status: 'failed',
		counters: {},
		error: SECRET
	} as const;
	db.insert(jobRuns).values(row).run();
	const builder = thrownBy(() => db.insert(jobRuns).values(row).run());
	const raw = thrownBy(() =>
		db.run(sql`insert into job_runs (id, error) values ('run-3', ${SECRET})`)
	);
	db.$client.close();
	const withParams = new DrizzleQueryError(
		'insert into "job_runs" ("id", "error") values (?, ?)',
		['run-1', SECRET],
		builder as Error
	);
	return { builder, raw, withParams };
}

function thrownBy(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error('expected the insert to fail');
}

describe('sanitizeErrorMessage', () => {
	it('never lets SQL text or bound values from a failing insert through', () => {
		const { builder, raw, withParams } = realQueryErrors();
		// The raw messages are what used to reach job_runs.error.
		expect((raw as Error).message).toMatch(/insert into job_runs/i);
		expect(withParams.message).toContain(SECRET);

		expect(sanitizeError(raw)).toBe(
			'DrizzleError: SqliteError: SQLITE_CONSTRAINT_NOTNULL [query redacted]'
		);
		expect(sanitizeError(withParams)).toBe(
			'DrizzleQueryError: SqliteError: SQLITE_CONSTRAINT_UNIQUE [query redacted]'
		);
		// The driver's own message names the constraint, never a value: kept, it is useful.
		expect(sanitizeError(builder)).toBe(
			'SqliteError: UNIQUE constraint failed: job_runs.idempotency_key'
		);
		for (const text of [raw, withParams, builder].map((error) => sanitizeError(error))) {
			expect(text).not.toContain(SECRET);
			expect(text).not.toMatch(/insert|values|params/i);
		}
		expect(sanitizeErrorMessage(withParams, 200)).toBe(sanitizeError(withParams));
	});

	it('redacts a plain error whose message carries SQL or a params dump', () => {
		const error = new Error(`Failed query: update events set title_th = ? params: ${SECRET}`);
		expect(sanitizeError(error)).toBe('Error [query redacted]');
		expect(sanitizeError(new Error(`bad row params: ${SECRET}`))).not.toContain(SECRET);
	});

	it('still finds SQL hidden behind a long run of whitespace', () => {
		const error = new Error(`${' '.repeat(5000)}params: ${SECRET}`);
		expect(sanitizeError(error)).toBe('Error [query redacted]');
	});

	it('keeps ordinary messages useful: one line, paths redacted, capped', () => {
		const error = new TypeError('cannot read C:\\app\\src\\lib\\file.ts\n  here');
		expect(sanitizeError(error)).toBe('TypeError: cannot read [path] here');
		expect(sanitizeError(new Error('feed timed out after 15 s'))).toBe(
			'Error: feed timed out after 15 s'
		);
		expect(sanitizeError(new Error('x'.repeat(1000)))).toHaveLength(300);
		expect(sanitizeErrorMessage(new Error('x'.repeat(1000)), 200)).toHaveLength(200);
		expect(sanitizeError('not an error')).toBe('unknown error');
	});

	it('checks a long message for SQL in bounded time', () => {
		const started = performance.now();
		sanitizeError(new Error('select '.repeat(50_000)));
		expect(performance.now() - started).toBeLessThan(200);
	});
});
