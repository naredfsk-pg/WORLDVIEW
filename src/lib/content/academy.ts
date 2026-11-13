/**
 * Academy lesson files (ARCHITECTURE §13): YAML frontmatter + Thai Markdown body.
 * Pure (no `node:fs`), so the parser runs anywhere; `academy.server.ts` reads the files.
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { CATEGORY_SLUGS, type Lesson } from '../types/domain';

/** Global day ranges per week: 7 / 7 / 7 / 9 (days 1–30). */
const WEEK_DAY_RANGES = { 1: [1, 7], 2: [8, 14], 3: [15, 21], 4: [22, 30] } as const;

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `.../week-{W}/day-{DD}-{slug}.md` */
const LESSON_PATH_PATTERN = /(?:^|\/)week-(\d+)\/day-(\d{2})-([a-z0-9-]+)\.md$/;

const nonEmpty = z.string().trim().min(1);

export const lessonFrontmatterSchema = z
	.object({
		id: z.string().regex(/^w[1-4]-d\d{2}$/, 'must look like "w1-d01"'),
		week: z.literal([1, 2, 3, 4]),
		day: z.number().int().min(1).max(30),
		slug: z.string().regex(KEBAB_CASE, 'must be kebab-case'),
		title: nonEmpty,
		summary: nonEmpty,
		learning_objectives: z.array(nonEmpty),
		glossary: z.array(z.object({ term: nonEmpty, term_th: nonEmpty, definition: nonEmpty })),
		key_questions: z.array(nonEmpty),
		further_reading: z.array(
			z.object({
				title: nonEmpty,
				publisher: nonEmpty,
				url: z.url({ protocol: /^https?$/ }).nullable(),
				note: z.string().optional()
			})
		),
		related_tags: z.array(z.string().regex(KEBAB_CASE, 'tags must be kebab-case')),
		related_categories: z.array(z.enum(CATEGORY_SLUGS)),
		last_reviewed_at: z.string().regex(ISO_DATE, 'must be "YYYY-MM-DD"')
	})
	.superRefine((lesson, ctx) => {
		const [firstDay, lastDay] = WEEK_DAY_RANGES[lesson.week];
		if (lesson.day < firstDay || lesson.day > lastDay) {
			ctx.addIssue({
				code: 'custom',
				path: ['day'],
				message: `day ${lesson.day} is not in week ${lesson.week} (${firstDay}–${lastDay})`
			});
		}
		const expectedId = `w${lesson.week}-d${String(lesson.day).padStart(2, '0')}`;
		if (lesson.id !== expectedId) {
			ctx.addIssue({ code: 'custom', path: ['id'], message: `expected "${expectedId}"` });
		}
	});

/**
 * Parses and validates one lesson file. `path` is repo-relative with forward slashes; its
 * week/day/slug must agree with the frontmatter. Throws an Error that names the file.
 */
export function parseLessonFile(path: string, raw: string): Lesson {
	const match = FRONTMATTER_PATTERN.exec(raw.replace(/^\uFEFF/, ''));
	if (!match) throw new Error(`${path}: missing "---" YAML frontmatter block`);

	let data: unknown;
	try {
		data = parseYaml(match[1]!);
	} catch (error) {
		throw new Error(`${path}: invalid YAML (${error instanceof Error ? error.message : error})`, {
			cause: error
		});
	}

	const result = lessonFrontmatterSchema.safeParse(data);
	if (!result.success) {
		const problems = result.error.issues.map(
			(issue) => `${issue.path.join('.')}: ${issue.message}`
		);
		throw new Error(`${path}: invalid frontmatter\n- ${problems.join('\n- ')}`);
	}

	const frontmatter = result.data;
	const pathParts = LESSON_PATH_PATTERN.exec(path);
	if (
		!pathParts ||
		Number(pathParts[1]) !== frontmatter.week ||
		Number(pathParts[2]) !== frontmatter.day ||
		pathParts[3] !== frontmatter.slug
	) {
		throw new Error(
			`${path}: file path must be week-${frontmatter.week}/day-${String(frontmatter.day).padStart(2, '0')}-${frontmatter.slug}.md`
		);
	}

	return { ...frontmatter, content_markdown: match[2]!.trim(), content_path: path };
}

/** Plain text for full-text search: Markdown syntax removed, whitespace collapsed. */
export function markdownToSearchText(markdown: string): string {
	return markdown
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ')
		.replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
		.replace(/[*_`~|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
