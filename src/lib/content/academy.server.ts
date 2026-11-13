/** Reads lesson files from disk (`node:fs`). Server and CLI only. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcademyLessonRow, Lesson } from '../types/domain';
import type { AcademyWeek, LessonDetail, LessonSummary } from '../types/views';
import {
	ACADEMY_WEEKS,
	markdownToSearchText,
	parseLessonFile,
	renderLessonMarkdown
} from './academy';
import { infographicText } from './infographic';

export const DEFAULT_ACADEMY_DIR = 'content/academy';
const EXPECTED_LESSON_COUNT = 30;

let cachedLessons: Lesson[] | undefined;
const cachedDetails = new Map<string, LessonDetail>();

/**
 * Strict loader for the site (memoized per process): all 30 lessons must parse, with unique ids and
 * days. Throws with every problem listed, so a broken content file fails loudly instead of
 * silently dropping a lesson.
 */
export function loadAllLessons(contentDir: string = DEFAULT_ACADEMY_DIR): Lesson[] {
	if (cachedLessons && contentDir === DEFAULT_ACADEMY_DIR) return cachedLessons;

	const { lessons, skipped } = readLessonFiles(contentDir);
	if (skipped.length > 0 || lessons.length !== EXPECTED_LESSON_COUNT) {
		const problems = skipped.map((problem) => problem.error);
		throw new Error(
			`Academy content in ${contentDir}: expected ${EXPECTED_LESSON_COUNT} valid lessons, got ${lessons.length}` +
				(problems.length > 0 ? `\n- ${problems.join('\n- ')}` : '')
		);
	}
	if (contentDir === DEFAULT_ACADEMY_DIR) cachedLessons = lessons;
	return lessons;
}

export function listLessonSummaries(): LessonSummary[] {
	return loadAllLessons().map(toLessonSummary);
}

export function getAcademyWeeks(): AcademyWeek[] {
	const summaries = listLessonSummaries();
	return ACADEMY_WEEKS.map((week) => ({
		...week,
		lessons: summaries.filter((lesson) => lesson.week === week.week)
	}));
}

/** `day` is global (1–30) and must belong to `week`; otherwise null (→ 404). */
export function getLessonDetail(week: number, day: number): LessonDetail | null {
	const lesson = loadAllLessons().find((item) => item.week === week && item.day === day);
	if (!lesson) return null;

	const cached = cachedDetails.get(lesson.id);
	if (cached) return cached;

	const { html, toc, folded } = renderLessonMarkdown(lesson.content_markdown);
	const detail: LessonDetail = {
		...toLessonSummary(lesson),
		learning_objectives: lesson.learning_objectives,
		glossary: lesson.glossary,
		key_questions: lesson.key_questions,
		further_reading: lesson.further_reading,
		related_tags: lesson.related_tags,
		last_reviewed_at: lesson.last_reviewed_at,
		takeaways: lesson.takeaways,
		infographics: lesson.infographics,
		html,
		toc,
		has_folded_sections: folded
	};
	cachedDetails.set(lesson.id, detail);
	return detail;
}

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
		search_text: lessonSearchText(lesson)
	}));
}

/** Lesson body plus the takeaways and infographic text, so search finds what the page shows. */
function lessonSearchText(lesson: Lesson): string {
	const visual = [...lesson.takeaways, ...lesson.infographics.flatMap(infographicText)];
	return `${markdownToSearchText(lesson.content_markdown)} ${visual.join(' ')}`.trim();
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

function toLessonSummary(lesson: Lesson): LessonSummary {
	return {
		id: lesson.id,
		week: lesson.week,
		day: lesson.day,
		slug: lesson.slug,
		title: lesson.title,
		summary: lesson.summary,
		related_categories: lesson.related_categories
	};
}
