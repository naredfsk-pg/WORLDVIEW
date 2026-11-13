/**
 * `npm run db:seed` (development): Academy catalog from content/academy/** plus fictional demo
 * news (is_demo = true). Idempotent; a second run reports 0 changes. Requires `db:migrate` first.
 */
import { readLessonFiles, toAcademyLessonRows } from '#lib/content/academy.server.js';
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';
import { countRows, seedDatabase } from '#lib/server/db/seed.js';

// Demo news must never reach production: allowlist, NODE_ENV must be explicitly development or
// test (`npm run db:seed` sets it through scripts/dev-tools.env); unset or production refuses.
// Production loads the lessons with `academy:sync` instead.
if (!getConfig().devToolsAllowed) {
	console.error('db:seed: refused: needs NODE_ENV=development or test (inserts demo news)');
	process.exit(1);
}

const { lessons, skipped } = readLessonFiles();
for (const problem of skipped) {
	console.warn(`db:seed: skipped lesson file: ${problem.error}`);
}

const db = openDb(getConfig().app.databaseUrl);
try {
	const report = seedDatabase(db, toAcademyLessonRows(lessons));
	for (const warning of report.warnings) console.warn(`db:seed: ${warning}`);

	console.log(`db:seed: ${lessons.length} lessons read, ${skipped.length} lesson files skipped`);
	console.table(report.changes);
	const totalChanges = Object.values(report.changes).reduce(
		(sum, table) => sum + table.inserted + table.updated,
		0
	);
	console.log(`db:seed: ${totalChanges} changes`);

	console.log('db:seed: row counts after seed');
	console.table(countRows(db));
} finally {
	db.$client.close();
}
