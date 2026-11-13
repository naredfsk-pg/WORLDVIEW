/**
 * SQLite backup and restore (PRD §11 #11, ARCHITECTURE §17), used by `scripts/backup.ts`
 * (`db:backup`) and `scripts/restore.ts` (`db:restore`).
 *
 * - Backup uses better-sqlite3's online `.backup()` API: a consistent snapshot that includes
 *   committed WAL frames, safe while the app and scheduler keep writing. The copy is written to a
 *   `.partial` file, switched to `journal_mode=DELETE` (one self-contained file, no -wal/-shm),
 *   checked with `PRAGMA integrity_check`, then renamed into place. Old backups beyond `keep` are
 *   deleted (newest kept, by file name, which sorts by time).
 * - Restore needs the app and scheduler stopped. It checks the source, keeps a safety copy of the
 *   current database, swaps the file in (removing stale -wal/-shm), checks it again and applies
 *   the migrations, so a backup taken before an upgrade works with the new code.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from './client';

export const BACKUP_FILE_PATTERN = /^worldview-\d{8}T\d{6}Z\.db$/;
export const DEFAULT_BACKUP_KEEP = 14;

export interface BackupResult {
	file: string;
	bytes: number;
	removed: string[];
}

export interface RestoreResult {
	target: string;
	/** Copy of the database that was replaced, or null when there was none. */
	safetyCopy: string | null;
	rowCounts: Record<string, number>;
}

/** `worldview-YYYYMMDDTHHMMSSZ.db` (UTC, so names sort by time and never depend on the host zone). */
export function backupFileName(now: Date): string {
	const stamp = now
		.toISOString()
		.replace(/\.\d{3}Z$/, 'Z')
		.replaceAll(/[-:]/g, '');
	return `worldview-${stamp}.db`;
}

/** `PRAGMA integrity_check` rows; `['ok']` means the file is sound. */
export function integrityCheck(sqlite: Database.Database): string[] {
	return sqlite
		.prepare('PRAGMA integrity_check')
		.all()
		.map((row) => String(Object.values(row as Record<string, unknown>)[0]));
}

/** Row count of every table (FTS shadow tables excluded), for logs and restore checks. */
export function tableRowCounts(sqlite: Database.Database): Record<string, number> {
	const tables = sqlite
		.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
			 AND name NOT LIKE '%_fts_%' ORDER BY name`
		)
		.all() as { name: string }[];
	return Object.fromEntries(
		tables.map(({ name }) => {
			const row = sqlite.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get();
			return [name, (row as { n: number }).n];
		})
	);
}

/** Online backup of `sqlite` into `dir`, then prune to the newest `keep` backups. */
export async function backupDatabase(
	sqlite: Database.Database,
	dir: string,
	options: { now?: Date; keep?: number } = {}
): Promise<BackupResult> {
	const keep = options.keep ?? DEFAULT_BACKUP_KEEP;
	if (!Number.isInteger(keep) || keep < 1) throw new Error('keep must be a positive integer');

	mkdirSync(resolve(dir), { recursive: true });
	const file = join(resolve(dir), backupFileName(options.now ?? new Date()));
	const partial = `${file}.partial`;
	rmSync(partial, { force: true });
	try {
		await sqlite.backup(partial);
		const copy = new Database(partial, { fileMustExist: true });
		try {
			copy.pragma('journal_mode = DELETE');
			const problems = integrityCheck(copy);
			if (problems.length !== 1 || problems[0] !== 'ok') {
				throw new Error(`backup failed integrity_check: ${problems.slice(0, 5).join('; ')}`);
			}
		} finally {
			copy.close();
		}
		renameSync(partial, file);
	} catch (error) {
		rmSync(partial, { force: true });
		throw error;
	}

	return { file, bytes: statSync(file).size, removed: pruneBackups(dir, keep) };
}

/** Deletes all but the newest `keep` files named like `backupFileName`; returns the removed paths. */
export function pruneBackups(dir: string, keep: number): string[] {
	const files = readdirSync(dir)
		.filter((name) => BACKUP_FILE_PATTERN.test(name))
		.sort()
		.reverse();
	const removed = files.slice(keep).map((name) => join(resolve(dir), name));
	for (const file of removed) rmSync(file, { force: true });
	return removed;
}

/**
 * Replaces the database at `target` with the backup `from`. The app and scheduler must be stopped.
 * Throws (and leaves the current database untouched) when `from` fails `integrity_check`.
 */
export async function restoreDatabase(options: {
	from: string;
	target: string;
	migrationsFolder: string;
	now?: Date;
}): Promise<RestoreResult> {
	const from = resolve(options.from);
	const target = resolve(options.target);
	if (from === target) throw new Error('the backup file and the target database are the same file');
	if (!existsSync(from)) throw new Error(`backup file not found: ${from}`);

	const source = new Database(from, { readonly: true, fileMustExist: true });
	const staged = `${target}.restore-partial`;
	rmSync(staged, { force: true });
	try {
		const problems = integrityCheck(source);
		if (problems.length !== 1 || problems[0] !== 'ok') {
			throw new Error(`backup failed integrity_check: ${problems.slice(0, 5).join('; ')}`);
		}
		// Stage next to the target (same filesystem, so the final rename is atomic).
		mkdirSync(dirname(target), { recursive: true });
		await source.backup(staged);
	} catch (error) {
		rmSync(staged, { force: true });
		throw error;
	} finally {
		source.close();
	}

	let safetyCopy: string | null = null;
	if (existsSync(target)) {
		const stamp = backupFileName(options.now ?? new Date()).replace(/^worldview-|\.db$/g, '');
		safetyCopy = `${target}.pre-restore-${stamp}`;
		const current = new Database(target, { fileMustExist: true });
		try {
			await current.backup(safetyCopy);
		} finally {
			current.close();
		}
	}
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });
	renameSync(staged, target);

	const db = openDb(`file:${target}`);
	try {
		const problems = integrityCheck(db.$client);
		if (problems.length !== 1 || problems[0] !== 'ok') {
			throw new Error(
				`restored database failed integrity_check: ${problems.slice(0, 5).join('; ')}`
			);
		}
		migrate(db, { migrationsFolder: options.migrationsFolder });
		return { target, safetyCopy, rowCounts: tableRowCounts(db.$client) };
	} finally {
		db.$client.close();
	}
}
