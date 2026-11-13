import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getConfig } from '../config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const BUSY_TIMEOUT_MS = 5000;

let sharedDb: Db | undefined;

/** Process-wide connection, opened lazily from DATABASE_URL. */
export function getDb(): Db {
	sharedDb ??= openDb(getConfig().app.databaseUrl);
	return sharedDb;
}

/**
 * Opens a SQLite database from a `file:<path>` URL (relative paths resolve from the working
 * directory) or `:memory:`, creating the parent directory when missing.
 */
export function openDb(databaseUrl: string): Db {
	const filename = toSqliteFilename(databaseUrl);
	if (filename !== ':memory:') {
		mkdirSync(dirname(filename), { recursive: true });
	}

	const sqlite = new Database(filename);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
	return drizzle(sqlite, { schema });
}

function toSqliteFilename(databaseUrl: string): string {
	if (databaseUrl === ':memory:') return databaseUrl;
	if (!databaseUrl.startsWith('file:')) {
		throw new Error('DATABASE_URL must be ":memory:" or start with "file:"');
	}
	return resolve(databaseUrl.slice('file:'.length));
}
