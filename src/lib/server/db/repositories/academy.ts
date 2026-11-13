/**
 * `AcademyCatalogRepository`: `academy_lessons` mirrors the content files. Upsert by id and delete
 * ids no longer present (their event links cascade); the FTS triggers keep `lessons_fts` in sync.
 */
import { notInArray } from 'drizzle-orm';
import type { AcademyCatalogRepository } from '../../../types/repositories';
import type { Db } from '../client';
import { academyLessons } from '../schema';

export function createAcademyCatalogRepository(db: Db): AcademyCatalogRepository {
	return {
		async replaceLessonCatalog(rows) {
			db.transaction((tx) => {
				const keepIds = rows.map((row) => row.id);
				tx.delete(academyLessons)
					.where(keepIds.length > 0 ? notInArray(academyLessons.id, keepIds) : undefined)
					.run();
				for (const { id, ...fields } of rows) {
					tx.insert(academyLessons)
						.values({ id, ...fields })
						.onConflictDoUpdate({ target: academyLessons.id, set: fields })
						.run();
				}
			});
		}
	};
}
