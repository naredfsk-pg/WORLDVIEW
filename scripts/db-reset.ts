/**
 * First step of `npm run db:reset` (development only): deletes the SQLite file and its WAL/SHM
 * side files. The npm script then runs `db:migrate` and `db:seed`.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConfig } from '#lib/server/config.js';

const config = getConfig();
if (config.nodeEnv === 'production') {
	console.error('db:reset: refusing to delete the database when NODE_ENV=production');
	process.exit(1);
}

const databaseUrl = config.app.databaseUrl;
if (databaseUrl === ':memory:') {
	console.log('db:reset: DATABASE_URL is :memory:, nothing to delete');
} else {
	const file = resolve(databaseUrl.slice('file:'.length));
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
	console.log('db:reset: database files deleted');
}
