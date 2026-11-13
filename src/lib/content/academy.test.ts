import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownToSearchText, parseLessonFile } from './academy';
import { readLessonFiles, toAcademyLessonRows } from './academy.server';

const PATH = 'content/academy/week-1/day-01-world-map-and-power.md';

const lessonFile = (overrides: Record<string, string> = {}) => {
	const fields: Record<string, string> = {
		id: '"w1-d01"',
		week: '1',
		day: '1',
		slug: '"world-map-and-power"',
		title: '"แผนที่โลกและอำนาจ"',
		summary: '"สรุปบทเรียน"',
		learning_objectives: '["เข้าใจภูมิรัฐศาสตร์"]',
		glossary: '[{ term: "NATO", term_th: "นาโต", definition: "พันธมิตรทางทหาร" }]',
		key_questions: '["ทำไม?"]',
		further_reading:
			'[{ title: "UN", publisher: "United Nations", url: null, note: "TODO: verify" }]',
		related_tags: '["geopolitics-basics"]',
		related_categories: '["geopolitics"]',
		last_reviewed_at: '"2026-11-13"',
		takeaways: '["ข้อแรก", "ข้อสอง", "ข้อสาม"]',
		infographics:
			'[{ type: "flow", title: "ลำดับ", summary: "เหตุนำไปสู่ผล", steps: [{ label: "เหตุ" }, { label: "ผล" }] }]',
		...overrides
	};
	const yaml = Object.entries(fields)
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');
	return `---\n${yaml}\n---\n## หัวข้อแรก\n\nเนื้อหา **สำคัญ** [ลิงก์](https://example.com)\n`;
};

describe('parseLessonFile', () => {
	it('parses valid frontmatter and body', () => {
		const lesson = parseLessonFile(PATH, lessonFile());
		expect(lesson).toMatchObject({ id: 'w1-d01', week: 1, day: 1, content_path: PATH });
		expect(lesson.further_reading[0]?.url).toBeNull();
		expect(lesson.content_markdown.startsWith('## หัวข้อแรก')).toBe(true);
	});

	it.each([
		[{ day: '8' }, 'day 8 is not in week 1'],
		[{ id: '"w1-d02"' }, 'expected "w1-d01"'],
		[{ related_categories: '["sports"]' }, 'related_categories'],
		[{ related_tags: '["Cold War"]' }, 'kebab-case'],
		[{ further_reading: '[{ title: "x", publisher: "y", url: "ftp://x" }]' }, 'further_reading'],
		[{ takeaways: '["ข้อเดียว"]' }, 'takeaways'],
		[{ infographics: '[]' }, 'infographics'],
		[
			{ infographics: '[{ type: "chart", title: "x", summary: "y", steps: [] }]' },
			'infographics.0.type'
		]
	])('rejects %j and names the file', (overrides, message) => {
		expect(() => parseLessonFile(PATH, lessonFile(overrides))).toThrow(message);
		expect(() => parseLessonFile(PATH, lessonFile(overrides))).toThrow(PATH);
	});

	it('rejects a path that disagrees with the frontmatter, or a missing frontmatter block', () => {
		expect(() => parseLessonFile('content/academy/week-1/day-02-x.md', lessonFile())).toThrow(
			/file path must be/
		);
		expect(() => parseLessonFile(PATH, '# no frontmatter')).toThrow(/frontmatter/);
	});
});

describe('markdownToSearchText', () => {
	it('strips Markdown syntax and keeps the text', () => {
		expect(
			markdownToSearchText('## หัวข้อ\n\n- **ตัวหนา** [ลิงก์](https://x.y)\n| a | b |\n|---|---|')
		).toBe('หัวข้อ ตัวหนา ลิงก์ a b');
	});
});

describe('readLessonFiles', () => {
	const dirs: string[] = [];
	afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

	it('returns valid lessons and reports invalid files instead of throwing', () => {
		const dir = mkdtempSync(join(tmpdir(), 'worldview-academy-'));
		dirs.push(dir);
		mkdirSync(join(dir, 'week-1'));
		writeFileSync(join(dir, 'week-1', 'day-01-world-map-and-power.md'), lessonFile());
		writeFileSync(join(dir, 'week-1', 'day-02-broken.md'), '---\nid: [\n---\n');

		const { lessons, skipped } = readLessonFiles(dir);

		expect(lessons.map((lesson) => lesson.id)).toEqual(['w1-d01']);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]?.error).toContain('day-02-broken.md');
		const searchText = toAcademyLessonRows(lessons)[0]?.search_text;
		expect(searchText).toContain('สำคัญ');
		// Takeaways and infographic text are searchable too.
		expect(searchText).toContain('ข้อสอง');
		expect(searchText).toContain('เหตุนำไปสู่ผล');
	});

	it('parses every lesson file currently in content/academy', () => {
		const { lessons, skipped } = readLessonFiles();
		expect(skipped).toEqual([]);
		expect(lessons).toHaveLength(30);
		for (const lesson of lessons) {
			expect(lesson.takeaways.length, lesson.id).toBeGreaterThanOrEqual(3);
			expect(lesson.infographics.length, lesson.id).toBeGreaterThanOrEqual(1);
		}
	});
});
