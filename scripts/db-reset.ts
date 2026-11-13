/**
 * First step of `npm run db:reset` (development only): deletes the SQLite file and its WAL/SHM
 * side files. The npm script then runs `db:migrate` and `db:seed`.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConfig } from '#lib/server/config.js';

const config = getConfig();
// Allowlist: NODE_ENV must be explicitly development or test (`npm run db:reset` sets it through
// scripts/dev-tools.env); unset or production refuses.
if (!config.devToolsAllowed) {
	console.error('db:reset: refused: needs NODE_ENV=development or test (dev-only tool)');
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
