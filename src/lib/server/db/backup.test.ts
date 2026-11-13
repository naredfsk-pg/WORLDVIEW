import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLessonFiles, toAcademyLessonRows } from '../../content/academy.server';
import {
	backupDatabase,
	backupFileName,
	integrityCheck,
	pruneBackups,
	restoreDatabase,
	tableRowCounts
} from './backup';
import { openDb, type Db } from './client';
import { seedDatabase } from './seed';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../migrations', import.meta.url));

let dir: string;
let source: Db;

/** A file database (WAL) with every migration, the 30 lessons and the demo news. */
function openSeededDb(file: string): Db {
	const db = openDb(`file:${file}`);
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	seedDatabase(db, toAcademyLessonRows(readLessonFiles().lessons));
	return db;
}

function readCounts(file: string): Record<string, number> {
	const db = new Database(file, { readonly: true, fileMustExist: true });
	try {
		return tableRowCounts(db);
	} finally {
		db.close();
	}
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'worldview-backup-'));
	source = openSeededDb(join(dir, 'live', 'worldview.db'));
});
afterEach(() => {
	if (source.$client.open) source.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('backupDatabase', () => {
	it('writes one self-contained, intact file named by UTC time', async () => {
		const now = new Date('2026-11-13T08:43:05.120Z');
		const result = await backupDatabase(source.$client, join(dir, 'backups'), { now });

		expect(result.file).toBe(join(dir, 'backups', 'worldview-20261113T084305Z.db'));
		expect(result.bytes).toBeGreaterThan(0);
		expect(readdirSync(join(dir, 'backups'))).toEqual(['worldview-20261113T084305Z.db']);

		const copy = new Database(result.file, { readonly: true });
		try {
			expect(integrityCheck(copy)).toEqual(['ok']);
			expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
			expect(tableRowCounts(copy)).toEqual(tableRowCounts(source.$client));
		} finally {
			copy.close();
		}
	});

	it('includes writes still in the WAL of the live database', async () => {
		source.$client.prepare("DELETE FROM academy_lessons WHERE id = 'w1-d01'").run();
		const result = await backupDatabase(source.$client, join(dir, 'backups'));
		expect(readCounts(result.file).academy_lessons).toBe(29);
	});

	it('keeps only the newest N backups', async () => {
		const backups = join(dir, 'backups');
		for (const minute of [1, 2, 3, 4]) {
			await backupDatabase(source.$client, backups, {
				now: new Date(`2026-11-13T00:0${minute}:00Z`),
				keep: 2
			});
		}
		writeFileSync(join(backups, 'notes.txt'), 'not a backup');

		expect(readdirSync(backups).sort()).toEqual([
			'notes.txt',
			'worldview-20261113T000300Z.db',
			'worldview-20261113T000400Z.db'
		]);
		expect(pruneBackups(backups, 1)).toEqual([join(backups, 'worldview-20261113T000300Z.db')]);
	});

	it('rejects a keep below 1', async () => {
		await expect(backupDatabase(source.$client, join(dir, 'backups'), { keep: 0 })).rejects.toThrow(
			'keep'
		);
	});
});

describe('restoreDatabase', () => {
	it('restores a seeded backup into a fresh path with the same row counts', async () => {
		const expected = tableRowCounts(source.$client);
		const { file } = await backupDatabase(source.$client, join(dir, 'backups'));
		const target = join(dir, 'restored', 'worldview.db');

		const result = await restoreDatabase({
			from: file,
			target,
			migrationsFolder: MIGRATIONS_FOLDER
		});

		expect(result.safetyCopy).toBeNull();
		expect(result.rowCounts).toEqual(expected);
		expect(expected.academy_lessons).toBe(30);
		expect(expected.lessons_fts).toBe(30);
		expect(expected.events).toBeGreaterThan(0);

		const restored = new Database(target, { readonly: true });
		try {
			expect(integrityCheck(restored)).toEqual(['ok']);
			const ftsHit = restored
				.prepare('SELECT count(*) AS n FROM lessons_fts WHERE lessons_fts MATCH ?')
				.get('"ภูมิรัฐศาสตร์"') as { n: number };
			expect(ftsHit.n).toBeGreaterThan(0);
		} finally {
			restored.close();
		}
	});

	it('keeps a safety copy of the database it replaces', async () => {
		const { file } = await backupDatabase(source.$client, join(dir, 'backups'));
		source.$client.prepare('DELETE FROM daily_brief_events').run();
		source.$client.close();
		const live = join(dir, 'live', 'worldview.db');
		const now = new Date('2026-11-13T09:00:00Z');

		const result = await restoreDatabase({
			from: file,
			target: live,
			migrationsFolder: MIGRATIONS_FOLDER,
			now
		});

		expect(result.safetyCopy).toBe(`${live}.pre-restore-20261113T090000Z`);
		expect(readCounts(result.safetyCopy!).daily_brief_events).toBe(0);
		expect(result.rowCounts.daily_brief_events).toBeGreaterThan(0);
	});

	it('refuses a file that is not an intact database and leaves the target alone', async () => {
		const bogus = join(dir, 'bogus.db');
		writeFileSync(bogus, 'this is not sqlite'.repeat(100));
		const live = join(dir, 'live', 'worldview.db');
		const before = tableRowCounts(source.$client);

		await expect(
			restoreDatabase({ from: bogus, target: live, migrationsFolder: MIGRATIONS_FOLDER })
		).rejects.toThrow();

		expect(tableRowCounts(source.$client)).toEqual(before);
		expect(existsSync(`${live}.restore-partial`)).toBe(false);
	});

	it('refuses to restore a file onto itself', async () => {
		const live = join(dir, 'live', 'worldview.db');
		await expect(
			restoreDatabase({ from: live, target: live, migrationsFolder: MIGRATIONS_FOLDER })
		).rejects.toThrow('same file');
	});
});

describe('backupFileName', () => {
	it('uses the UTC time, independent of the host zone', () => {
		expect(backupFileName(new Date('2026-11-12T17:00:00.999Z'))).toBe(
			'worldview-20261112T170000Z.db'
		);
	});
});
