/**
 * `npm run db:migrate`: applies `migrations/*.sql` with Drizzle's runtime migrator, so the
 * production image does not need drizzle-kit (a devDependency). Run from the repo/app root.
 */
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';

const db = openDb(getConfig().app.databaseUrl);
try {
	migrate(db, { migrationsFolder: resolve('migrations') });
	console.log('db:migrate: all migrations applied');
} finally {
	db.$client.close();
}
