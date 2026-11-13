/**
 * `npm run db:backup -- [--dir DIR] [--keep N]`: online SQLite backup (better-sqlite3 `.backup()`,
 * safe while the app and scheduler write in WAL mode) to `DIR/worldview-YYYYMMDDTHHMMSSZ.db`,
 * checked with `PRAGMA integrity_check`, then keeps only the newest N backups.
 *
 * Defaults: `BACKUP_DIR` (./data/backups; `/backups` in the container, a host bind mount) and
 * `BACKUP_KEEP` (14). The scheduler runs it daily (docker/crontab). Exit 0 ok · 1 failed · 64 usage.
 */
import { parseArgs } from 'node:util';
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';
import { backupDatabase } from '#lib/server/db/backup.js';

const USAGE = 'usage: db:backup [--dir DIR] [--keep N]';

let args;
try {
	args = parseArgs({
		args: process.argv.slice(2),
		options: { dir: { type: 'string' }, keep: { type: 'string' } },
		strict: true
	}).values;
} catch (error) {
	console.error(`db:backup: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
	process.exit(64);
}

const config = getConfig();
const keep = args.keep === undefined ? config.backup.keep : Number(args.keep);
if (!Number.isInteger(keep) || keep < 1) {
	console.error(`db:backup: --keep must be a positive integer\n${USAGE}`);
	process.exit(64);
}
if (config.app.databaseUrl === ':memory:') {
	console.error('db:backup: DATABASE_URL is :memory:, nothing to back up');
	process.exit(64);
}

const startedAt = Date.now();
const db = openDb(config.app.databaseUrl);
try {
	const result = await backupDatabase(db.$client, args.dir ?? config.backup.dir, { keep });
	console.log(
		JSON.stringify({
			msg: 'db:backup finished',
			file: result.file,
			bytes: result.bytes,
			removed: result.removed.length,
			keep,
			duration_ms: Date.now() - startedAt
		})
	);
} catch (error) {
	console.error(`db:backup: failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	db.$client.close();
}
