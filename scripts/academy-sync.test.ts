/**
 * `academy:sync` end to end: runs the real CLI (through tsx, like `npm run academy:sync`) against
 * a scratch database file. This is the content step of the production start-up, so it must load
 * all 30 lessons, be idempotent, never write demo news and never touch existing news rows.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/lib/server/db/client';
import { seedDatabase } from '../src/lib/server/db/seed';

const ROOT = resolve(import.meta.dirname, '..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

let dir: string;
let databaseUrl: string;

function runScript(script: string, cwd = ROOT) {
	const result = spawnSync(process.execPath, [TSX_CLI, join(ROOT, 'scripts', script)], {
		cwd,
		env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: databaseUrl },
		encoding: 'utf8',
		timeout: 60_000
	});
	return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function counts(): Record<string, number> {
	const db = new Database(databaseUrl.slice('file:'.length), { readonly: true });
	try {
		const tables = ['academy_lessons', 'lessons_fts', 'events', 'articles', 'sources'];
		return Object.fromEntries(
			tables.map((table) => [
				table,
				(db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
			])
		);
	} finally {
		db.close();
	}
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'worldview-academy-sync-'));
	databaseUrl = `file:${join(dir, 'worldview.db')}`;
	expect(runScript('migrate.ts').status).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scripts/academy-sync.ts', () => {
	it('loads the 30 lessons and no demo news, and a rerun changes nothing', () => {
		const first = runScript('academy-sync.ts');
		expect(first.status, first.output).toBe(0);
		expect(first.output).toContain('30 lessons synced');
		const afterFirst = counts();
		expect(afterFirst).toEqual({
			academy_lessons: 30,
			lessons_fts: 30,
			events: 0,
			articles: 0,
			sources: 0
		});

		expect(runScript('academy-sync.ts').status).toBe(0);
		expect(counts()).toEqual(afterFirst);
	}, 120_000);

	it('leaves existing news rows alone', () => {
		const db = openDb(databaseUrl);
		seedDatabase(db, []);
		db.$client.close();
		const before = counts();
		expect(before.events).toBeGreaterThan(0);

		expect(runScript('academy-sync.ts').status).toBe(0);
		expect(counts()).toEqual({ ...before, academy_lessons: 30, lessons_fts: 30 });
	}, 120_000);

	it('exits 1 without writing when lesson files are missing', () => {
		const content = join(dir, 'app', 'content', 'academy');
		cpSync(join(ROOT, 'content', 'academy'), content, { recursive: true });
		rmSync(join(content, 'week-1'), { recursive: true, force: true });

		const result = runScript('academy-sync.ts', join(dir, 'app'));
		expect(result.status).toBe(1);
		expect(result.output).toContain('expected 30 valid lessons');
		expect(counts().academy_lessons).toBe(0);
	}, 120_000);
});
