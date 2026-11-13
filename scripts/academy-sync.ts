/**
 * `npm run academy:sync` (production and dev): mirrors the 30 lesson files in content/academy/**
 * into `academy_lessons` (and, through the triggers, `lessons_fts`). It never touches news tables
 * and never inserts demo data, so it is the content step the production container runs at start
 * (after `db:migrate`, ARCHITECTURE §17); `db:seed` stays dev-only.
 *
 * Uses the strict loader: if any lesson file is invalid or missing, it exits 1 without writing,
 * so a broken content file can never delete a lesson (and its event links) from the catalog.
 * Idempotent: a rerun leaves the same 30 rows. Requires `db:migrate` first.
 */
import { loadAllLessons, toAcademyLessonRows } from '#lib/content/academy.server.js';
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';
import { createAcademyCatalogRepository } from '#lib/server/db/repositories/academy.js';

let lessons;
try {
	lessons = loadAllLessons();
} catch (error) {
	console.error(`academy:sync: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

const db = openDb(getConfig().app.databaseUrl);
try {
	await createAcademyCatalogRepository(db).replaceLessonCatalog(toAcademyLessonRows(lessons));
	const count = (table: string) =>
		(db.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
	console.log(
		`academy:sync: ${lessons.length} lessons synced (academy_lessons=${count('academy_lessons')}, lessons_fts=${count('lessons_fts')})`
	);
} finally {
	db.$client.close();
}
