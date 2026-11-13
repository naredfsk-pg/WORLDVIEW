import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { parse as parseYaml } from 'yaml';

/**
 * PRD §11 #2: all 30 lessons are reachable by stable routes, in a browser (not only as HTTP 200).
 * The expected list comes from the content files, so a missing or renamed lesson fails here.
 */
interface LessonFile {
	week: number;
	day: number;
	title: string;
	route: string;
}

const LESSONS = readLessonFiles();

test('the content has 30 lessons, days 1–30, one stable route each', () => {
	expect(LESSONS).toHaveLength(30);
	expect(LESSONS.map((lesson) => lesson.day)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
	expect(new Set(LESSONS.map((lesson) => lesson.route)).size).toBe(30);
});

test('the Academy index links every lesson route across the four weeks', async ({ page }) => {
	const linked = new Set<string>();
	for (const week of [1, 2, 3, 4]) {
		await page.goto(`/academy?week=${week}`);
		// Resolved paths: the server renders relative hrefs ("./academy/…") until hydration.
		const paths = await page
			.locator('a[data-testid="lesson-card"]')
			.evaluateAll((nodes) =>
				nodes.map((node) => new URL((node as HTMLAnchorElement).href).pathname)
			);
		for (const path of paths) linked.add(path);
	}
	expect([...linked].sort()).toEqual(LESSONS.map((lesson) => lesson.route).sort());
});

for (const [index, lesson] of LESSONS.entries()) {
	test(`day ${lesson.day} renders its title with previous/next links`, async ({ page }) => {
		const response = await page.goto(lesson.route);
		expect(response?.status()).toBe(200);
		await expect(page.getByTestId('lesson-article').locator('h1')).toContainText(lesson.title);

		const previous = LESSONS[index - 1];
		const next = LESSONS[index + 1];
		const previousLink = page.locator('a', { hasText: 'บทก่อนหน้า' });
		const nextLink = page.locator('a', { hasText: 'บทถัดไป' });
		if (previous) expect(await pathOf(previousLink)).toBe(previous.route);
		else await expect(previousLink).toHaveCount(0);
		if (next) expect(await pathOf(nextLink)).toBe(next.route);
		else await expect(nextLink).toHaveCount(0);
	});
}

function pathOf(link: Locator): Promise<string> {
	return link.evaluate((node) => new URL((node as HTMLAnchorElement).href).pathname);
}

function readLessonFiles(): LessonFile[] {
	const root = 'content/academy';
	return readdirSync(root)
		.filter((dir) => dir.startsWith('week-'))
		.flatMap((dir) =>
			readdirSync(join(root, dir))
				.filter((file) => file.endsWith('.md'))
				.map((file) => toLesson(readFileSync(join(root, dir, file), 'utf8')))
		)
		.sort((a, b) => a.day - b.day);
}

function toLesson(markdown: string): LessonFile {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
	if (!frontmatter) throw new Error('lesson file without frontmatter');
	const data = parseYaml(frontmatter) as { week: number; day: number; title: string };
	return {
		week: data.week,
		day: data.day,
		title: data.title,
		route: `/academy/week/${data.week}/day/${data.day}`
	};
}
