import type { RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestDb } from '#lib/server/db/test-db.js';
import { handleError } from './hooks.server';

const event = { url: new URL('http://localhost/admin/review') } as RequestEvent;

function loggedLine(spy: { mock: { calls: unknown[][] } }): string {
	return spy.mock.calls.map((args) => args.join(' ')).join('\n');
}

afterEach(() => vi.restoreAllMocks());

describe('handleError', () => {
	it('logs only the names and driver code of query errors, never SQL text or params', async () => {
		const db = openTestDb();
		let runError: unknown;
		let driverError: unknown;
		try {
			db.run(sql`select * from missing_table where secret = ${'super-secret-value'}`);
		} catch (error) {
			runError = error;
		}
		try {
			db.$client.prepare('select * from missing_table');
		} catch (error) {
			driverError = error;
		}
		db.$client.close();
		// Builder queries throw DrizzleQueryError, whose message carries the SQL and the params.
		const queryError = new DrizzleQueryError(
			'select * from missing_table where secret = ?',
			['super-secret-value'],
			driverError as Error
		);
		expect((runError as Error).message).toContain('missing_table');
		expect(queryError.message).toContain('super-secret-value');

		for (const [error, expected] of [
			[runError, 'DrizzleError: SqliteError: SQLITE_ERROR'],
			[queryError, 'DrizzleQueryError: SqliteError: SQLITE_ERROR']
		] as const) {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const result = await handleError({ kind: 'unknown', error, event });

			const line = loggedLine(spy);
			expect(line).toContain(expected);
			expect(line).not.toMatch(/super-secret-value|missing_table|select/i);
			expect(result).toMatchObject({ error_id: expect.any(String) });
			expect((result as { message: string }).message).toContain('รหัสอ้างอิง');
			spy.mockRestore();
		}
	});

	it('redacts any error whose message looks like SQL', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('UPDATE events SET title_th = ? WHERE id = ? params: x,y');
		await handleError({ kind: 'unknown', error, event });

		expect(loggedLine(spy)).not.toMatch(/UPDATE|params|title_th/);
		expect(loggedLine(spy)).toContain('[query redacted]');
	});

	it('keeps ordinary messages (paths redacted) and never logs the stack', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new TypeError('cannot read C:\\app\\src\\lib\\file.ts here');
		await handleError({ kind: 'unknown', error, event });

		const line = loggedLine(spy);
		expect(line).toContain('TypeError: cannot read [path] here');
		expect(line).not.toContain('at ');
	});
});
