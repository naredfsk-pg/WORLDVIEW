import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcademyLessonRow } from '../../types/domain';
import type { Db } from './client';
import { DEMO_BRIEFS, DEMO_EVENTS } from './fixtures/demo';
import { academyLessons, events } from './schema';
import { countRows, seedDatabase } from './seed';
import { openTestDb } from './test-db';

let db: Db;

beforeEach(() => {
	db = openTestDb();
});
afterEach(() => db.$client.close());

const lesson = (id: string, day: number): AcademyLessonRow => ({
	id,
	week: 1,
	day,
	slug: `lesson-${day}`,
	title: `บทเรียน ${day}`,
	summary: 'สรุป',
	content_path: `content/academy/week-1/day-0${day}-lesson-${day}.md`,
	tags: [],
	categories: ['geopolitics'],
	search_text: 'เนื้อหา'
});

describe('seedDatabase', () => {
	it('is idempotent: the second run changes nothing', () => {
		const lessons = [lesson('w1-d06', 6), lesson('w1-d07', 7)];
		const first = seedDatabase(db, lessons);
		const countsAfterFirst = countRows(db);
		const second = seedDatabase(db, lessons);

		const total = (report: typeof first) =>
			Object.values(report.changes).reduce((sum, table) => sum + table.inserted + table.updated, 0);
		expect(total(first)).toBeGreaterThan(0);
		expect(total(second)).toBe(0);
		expect(countRows(db)).toEqual(countsAfterFirst);
	});

	it('skips lesson links whose lesson is not in the catalog, with a warning', () => {
		const report = seedDatabase(db, [lesson('w1-d07', 7)]);
		expect(report.warnings.length).toBeGreaterThan(0);
		expect(report.warnings.every((warning) => warning.includes('not in catalog'))).toBe(true);
	});

	it('updates a changed lesson in place and keeps FTS in sync', () => {
		seedDatabase(db, [lesson('w1-d07', 7)]);
		const report = seedDatabase(db, [{ ...lesson('w1-d07', 7), title: 'ชื่อใหม่ของบทเรียน' }]);

		expect(report.changes.academy_lessons).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
		expect(
			db.select().from(academyLessons).where(eq(academyLessons.id, 'w1-d07')).get()?.title
		).toBe('ชื่อใหม่ของบทเรียน');
		expect(countRows(db).lessons_fts).toBe(1);
	});

	it('marks every demo row as demo and derives event_date in Bangkok time', () => {
		seedDatabase(db, []);
		const rows = db.select().from(events).all();

		expect(rows).toHaveLength(DEMO_EVENTS.length);
		expect(rows.every((row) => row.is_demo)).toBe(true);
		// demo-evt-06's first article is 00:40 ICT = 17:40 UTC the day before.
		expect(rows.find((row) => row.id === 'demo-evt-06')).toMatchObject({
			first_seen_at: '2026-11-12T17:40:00.000Z',
			event_date: '2026-11-13'
		});
	});

	it('fixtures: briefs only reference published events and cover at least 4 dates', () => {
		const published = new Set(DEMO_EVENTS.filter((e) => e.status === 'published').map((e) => e.id));
		for (const brief of DEMO_BRIEFS) {
			for (const item of brief.items) expect(published.has(item.event_id)).toBe(true);
		}
		expect(new Set(DEMO_BRIEFS.map((brief) => brief.brief_date)).size).toBeGreaterThanOrEqual(4);
	});
});
