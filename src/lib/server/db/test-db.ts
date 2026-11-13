/** Test helper: a fresh in-memory database with every migration applied (schema + FTS). */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb, type Db } from './client';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../migrations', import.meta.url));

export function openTestDb(): Db {
	const db = openDb(':memory:');
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db;
}
