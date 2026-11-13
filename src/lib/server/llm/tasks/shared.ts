/**
 * Shared pieces of the task modules: the `TaskDefinition` shape and reusable Zod fragments.
 *
 * Validation split: Zod checks shape and closed sets (enums strict, unknown keys stripped);
 * `findUnknownRefs` checks that every ref / lesson id was supplied in the input (else
 * `invalid_output`). Empty evidence lists are allowed here on purpose: the editorial gates turn
 * them into `unsupported_claim` (events) or `drop` (relations) per item.
 */
import { z } from 'zod';
import type { LlmInput, LlmOutput, LlmTask } from '../../../types/llm';
import { buildSystemPrompt } from '../prompt';

export interface TaskDefinition<T extends LlmTask> {
	task: T;
	/** `<task>@<n>`; bump on any prompt or schema change (it is part of the cache key). */
	promptVersion: string;
	systemPrompt: string;
	outputSchema: z.ZodType<LlmOutput<T>>;
	/** Issues for refs or ids in the output that were not supplied in the input. */
	findUnknownRefs(output: LlmOutput<T>, input: LlmInput<T>): string[];
	/** Cap on `input.articles` for tasks that take an article list; null otherwise. */
	maxArticles: number | null;
}

export function defineTask<T extends LlmTask>(spec: {
	task: T;
	promptVersion: string;
	instructions: string;
	outputSchema: z.ZodType<LlmOutput<T>>;
	findUnknownRefs: TaskDefinition<T>['findUnknownRefs'];
	maxArticles?: number;
}): TaskDefinition<T> {
	const jsonSchema = z.toJSONSchema(spec.outputSchema, { io: 'input', unrepresentable: 'any' });
	return {
		task: spec.task,
		promptVersion: spec.promptVersion,
		systemPrompt: buildSystemPrompt(spec.instructions, jsonSchema),
		outputSchema: spec.outputSchema,
		findUnknownRefs: spec.findUnknownRefs,
		maxArticles: spec.maxArticles ?? null
	};
}

/** ARCHITECTURE §10: at most 12 articles per extraction / summary call. */
export const MAX_ARTICLES_PER_CALL = 12;
/** ARCHITECTURE §9 digest order: tagging takes up to 20 (metadata only). */
export const MAX_ARTICLES_PER_TAGGING_CALL = 20;

export type OutputValidation<T extends LlmTask> =
	{ ok: true; data: LlmOutput<T> } | { ok: false; issues: string[] };

const MAX_REPORTED_ISSUES = 10;

/** Zod shape check, then the ref check. Issues are short and never echo the input data. */
export function validateOutput<T extends LlmTask>(
	definition: TaskDefinition<T>,
	input: LlmInput<T>,
	value: unknown
): OutputValidation<T> {
	const parsed = definition.outputSchema.safeParse(value);
	if (!parsed.success) {
		const issues = parsed.error.issues.map(
			(issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
		);
		return { ok: false, issues: issues.slice(0, MAX_REPORTED_ISSUES) };
	}

	const unknownRefs = definition.findUnknownRefs(parsed.data, input);
	if (unknownRefs.length > 0) {
		return { ok: false, issues: unknownRefs.slice(0, MAX_REPORTED_ISSUES) };
	}
	return { ok: true, data: parsed.data };
}

/**
 * One issue per location with unknown refs: the path and the count only. Model-produced ref
 * strings are never copied into the repair message (it sits outside `<data>`).
 */
export function unknownRefIssues(
	refs: readonly string[],
	allowed: ReadonlySet<string>,
	where: string
): string[] {
	const unknownCount = refs.filter((ref) => !allowed.has(ref)).length;
	return unknownCount === 0 ? [] : [`${where}: ${unknownCount} unknown ref(s)`];
}

export const refSchema = z.string().trim().min(1).max(32);
export const refListSchema = z.array(refSchema).max(24);

/** Generated Thai (or claimant name) text. Thai-script and URL checks are editorial gates. */
export const textSchema = (max: number) => z.string().trim().max(max);

export const confidenceSchema = z.number().min(0).max(1);

/** kebab-case English; light normalization ("Cold War" → "cold-war") before the strict check. */
export const tagSchema = z
	.string()
	.trim()
	.toLowerCase()
	.overwrite((value) => value.replace(/[\s_]+/g, '-'))
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.max(40);

/** ISO 3166-1 alpha-2, upper case. */
export const countrySchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z]{2}$/);

/** A stated instant with an explicit offset, normalized to `toISOString()` form. */
export const isoInstantSchema = z.iso
	.datetime({ offset: true })
	.transform((value) => new Date(value).toISOString());
