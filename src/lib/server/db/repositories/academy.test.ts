import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcademyLessonRow } from '../../../types/domain';
import type { Db } from '../client';
import { countRows, seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { createRepositories } from './index';

let db: Db;
let repos: ReturnType<typeof createRepositories>;

beforeEach(() => {
	db = openTestDb();
	repos = createRepositories(db);
});
afterEach(() => db.$client.close());

const row = (id: string, day: number, title: string): AcademyLessonRow => ({
	id,
	week: 1,
	day,
	slug: `lesson-${day}`,
	title,
	summary: 'สรุปบทเรียน',
	content_path: `content/academy/week-1/day-0${day}-lesson-${day}.md`,
	tags: ['alliances'],
	categories: ['geopolitics'],
	search_text: 'เนื้อหาเกี่ยวกับพันธมิตร'
});

describe('AcademyCatalogRepository.replaceLessonCatalog', () => {
	it('upserts by id, removes missing lessons with their event links, and keeps FTS in sync', async () => {
		seedDatabase(db, [row('w1-d06', 6, 'UN และ NATO'), row('w1-d07', 7, 'สหรัฐฯ และจีน')]);
		expect(await repos.read.listPublishedEventsForLesson('w1-d06', 5)).toHaveLength(1);

		await repos.academy.replaceLessonCatalog([row('w1-d07', 7, 'สหรัฐฯ กับจีนในโลกปัจจุบัน')]);

		expect(countRows(db)).toMatchObject({ academy_lessons: 1, lessons_fts: 1 });
		expect(await repos.read.listPublishedEventsForLesson('w1-d06', 5)).toEqual([]);
		const found = await repos.read.searchLessons({
			q: 'โลกปัจจุบัน',
			scope: 'lessons',
			category: null,
			region: null,
			from: null,
			to: null,
			limit: 20,
			offset: 0
		});
		expect(found.items.map((lesson) => lesson.id)).toEqual(['w1-d07']);
	});
});
