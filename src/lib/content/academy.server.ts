/** Reads lesson files from disk (`node:fs`). Server and CLI only. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcademyLessonRow, Lesson } from '../types/domain';
import { markdownToSearchText, parseLessonFile } from './academy';

export const DEFAULT_ACADEMY_DIR = 'content/academy';

export interface LessonFileProblem {
	path: string;
	error: string;
}

/**
 * Lenient loader for seeding/sync while content is still being written: every valid
 * `week-*\/day-*.md` file is returned (sorted by day); invalid or duplicate files are reported in
 * `skipped` instead of throwing. `contentDir` is relative to the working directory.
 */
export function readLessonFiles(contentDir: string = DEFAULT_ACADEMY_DIR): {
	lessons: Lesson[];
	skipped: LessonFileProblem[];
} {
	const lessons: Lesson[] = [];
	const skipped: LessonFileProblem[] = [];
	const seenIds = new Set<string>();
	const seenDays = new Set<number>();

	for (const path of listLessonPaths(contentDir)) {
		try {
			const lesson = parseLessonFile(path, readFileSync(path, 'utf8'));
			if (seenIds.has(lesson.id) || seenDays.has(lesson.day)) {
				throw new Error(`${path}: duplicate lesson id "${lesson.id}" or day ${lesson.day}`);
			}
			seenIds.add(lesson.id);
			seenDays.add(lesson.day);
			lessons.push(lesson);
		} catch (error) {
			skipped.push({ path, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { lessons: lessons.sort((a, b) => a.day - b.day), skipped };
}

export function toAcademyLessonRows(lessons: Lesson[]): AcademyLessonRow[] {
	return lessons.map((lesson) => ({
		id: lesson.id,
		week: lesson.week,
		day: lesson.day,
		slug: lesson.slug,
		title: lesson.title,
		summary: lesson.summary,
		content_path: lesson.content_path,
		tags: lesson.related_tags,
		categories: lesson.related_categories,
		search_text: markdownToSearchText(lesson.content_markdown)
	}));
}

/** Repo-relative, forward-slash paths of `week-*\/day-*.md`, in name order. */
function listLessonPaths(contentDir: string): string[] {
	const weekDirs = readdirSync(contentDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^week-\d+$/.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	return weekDirs.flatMap((weekDir) =>
		readdirSync(join(contentDir, weekDir))
			.filter((name) => /^day-.+\.md$/.test(name))
			.sort()
			.map((name) => `${contentDir.replaceAll('\\', '/')}/${weekDir}/${name}`)
	);
}
