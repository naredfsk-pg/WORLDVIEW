import { beforeAll, describe, expect, it } from 'vitest';
import { readLessonFiles, toAcademyLessonRows } from '#lib/content/academy.server.js';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { seedDatabase } from '#lib/server/db/seed.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import { relationWindowStart } from './window';

describe('relationWindowStart', () => {
	it('anchors to Bangkok midnight 30 days before the latest brief, whatever the clock says', () => {
		const farFuture = new Date('2031-01-01T00:00:00.000Z');
		// 2026-10-14 00:00 ICT = 2026-10-13 17:00 UTC
		expect(relationWindowStart('2026-11-13', farFuture)).toBe('2026-10-13T17:00:00.000Z');
		expect(relationWindowStart('2026-11-13', new Date('2026-11-13T05:00:00.000Z'))).toBe(
			'2026-10-13T17:00:00.000Z'
		);
	});

	it('falls back to 30 days before now when there is no brief', () => {
		expect(relationWindowStart(null, new Date('2026-11-13T00:00:00.000Z'))).toBe(
			'2026-10-14T00:00:00.000Z'
		);
	});
});

describe('/connections window with the seeded demo data', () => {
	let db: Db;
	beforeAll(() => {
		db = openTestDb();
		seedDatabase(db, toAcademyLessonRows(readLessonFiles().lessons));
	});

	it('still lists the demo relations when the clock is years past the fixtures', async () => {
		const { read } = createRepositories(db);
		const latest = await read.getLatestPublishedBriefDate();
		const relations = await read.listPublishedRelations({
			since: relationWindowStart(latest, new Date('2031-01-01T00:00:00.000Z')),
			category: null,
			limit: 50
		});
		expect(relations.length).toBeGreaterThan(0);
		expect(relations.some((relation) => relation.relation_type === 'potential_impact')).toBe(true);
	});
});
