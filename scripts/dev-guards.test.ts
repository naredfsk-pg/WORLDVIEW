/**
 * Dev-only tools refuse unless NODE_ENV is explicitly `development` or `test` (allowlist,
 * security review finding 4): `db:seed` (demo news), `db:reset` (deletes the database) and
 * `job ingest --fixtures` (fictional feeds into the database). An unset NODE_ENV must refuse
 * like `production` does. Runs the real scripts through tsx against a scratch database.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

let dir: string;
let dbFile: string;

/** `nodeEnv: undefined` removes NODE_ENV from the child environment entirely. */
function runScript(args: string[], nodeEnv: string | undefined) {
	const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${dbFile}` };
	delete env.NODE_ENV;
	if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
	const [script, ...rest] = args;
	const result = spawnSync(process.execPath, [TSX_CLI, join(ROOT, 'scripts', script!), ...rest], {
		cwd: ROOT,
		env,
		encoding: 'utf8',
		timeout: 60_000
	});
	return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function count(table: string): number {
	const db = new Database(dbFile, { readonly: true });
	try {
		return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
	} finally {
		db.close();
	}
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'worldview-dev-guards-'));
	dbFile = join(dir, 'worldview.db');
	expect(runScript(['migrate.ts'], 'production').status).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.each([
	['unset', undefined],
	['production', 'production']
])('NODE_ENV %s', (_label, nodeEnv) => {
	it('db:seed refuses and writes nothing', () => {
		const result = runScript(['seed.ts'], nodeEnv);
		expect(result.status).toBe(1);
		expect(result.output).toContain('db:seed: refused');
		expect(count('events')).toBe(0);
		expect(count('academy_lessons')).toBe(0);
	}, 60_000);

	it('db:reset refuses and keeps the database', () => {
		const result = runScript(['db-reset.ts'], nodeEnv);
		expect(result.status).toBe(1);
		expect(result.output).toContain('db:reset: refused');
		expect(existsSync(dbFile)).toBe(true);
	}, 60_000);

	it('job ingest --fixtures refuses with a usage error before touching the database', () => {
		const result = runScript(['job.ts', 'ingest', '--fixtures'], nodeEnv);
		expect(result.status).toBe(64);
		expect(result.output).toContain('--fixtures needs NODE_ENV=development or test');
		expect(count('job_runs')).toBe(0);
	}, 60_000);
});

describe('NODE_ENV development (explicit)', () => {
	it('db:reset deletes the database files', () => {
		const result = runScript(['db-reset.ts'], 'development');
		expect(result.status, result.output).toBe(0);
		expect(existsSync(dbFile)).toBe(false);
	}, 60_000);
});
