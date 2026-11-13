/**
 * `npm run db:restore -- --from FILE --yes [--to file:PATH]`: replaces the database with a backup.
 *
 * Stop the app and the scheduler first (`docker compose stop app scheduler`): SQLite cannot swap
 * a file under open connections. Steps: `PRAGMA integrity_check` on the backup (abort if not ok),
 * keep a safety copy of the current database (`<db>.pre-restore-<UTC stamp>`), swap the file in
 * (removing stale -wal/-shm), `integrity_check` again, apply migrations, print row counts.
 *
 * `--yes` is required: without it nothing is changed. `--to` defaults to DATABASE_URL (use it to
 * test a backup by restoring into a scratch path). Exit 0 ok · 1 failed · 64 usage.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getConfig } from '#lib/server/config.js';
import { restoreDatabase } from '#lib/server/db/backup.js';

const USAGE = 'usage: db:restore --from FILE --yes [--to file:PATH]';

let args;
try {
	args = parseArgs({
		args: process.argv.slice(2),
		options: {
			from: { type: 'string' },
			to: { type: 'string' },
			yes: { type: 'boolean', default: false }
		},
		strict: true
	}).values;
} catch (error) {
	console.error(`db:restore: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
	process.exit(64);
}

const targetUrl = args.to ?? getConfig().app.databaseUrl;
if (!args.from) {
	console.error(`db:restore: --from is required\n${USAGE}`);
	process.exit(64);
}
if (targetUrl === ':memory:') {
	console.error('db:restore: the target is :memory:, nothing to restore into');
	process.exit(64);
}
const target = resolve(targetUrl.startsWith('file:') ? targetUrl.slice('file:'.length) : targetUrl);

if (!args.yes) {
	console.error(
		`db:restore: this replaces ${target} with ${resolve(args.from)}.\n` +
			'Stop the app and the scheduler first, then run again with --yes. Nothing was changed.'
	);
	process.exit(64);
}

try {
	const result = await restoreDatabase({
		from: args.from,
		target,
		migrationsFolder: resolve('migrations')
	});
	console.log(`db:restore: restored ${result.target} (integrity_check ok, migrations applied)`);
	if (result.safetyCopy) console.log(`db:restore: previous database kept as ${result.safetyCopy}`);
	console.table(result.rowCounts);
} catch (error) {
	console.error(`db:restore: failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
