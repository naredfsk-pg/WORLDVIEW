/** `extraction`: normalized facts and attributed claims of one event, each with evidence refs. */
import { z } from 'zod';
import type { ExtractionOutput } from '../../../types/llm';
import {
	countrySchema,
	defineTask,
	isoInstantSchema,
	refListSchema,
	textSchema,
	unknownRefIssues
} from './shared';

export const EXTRACTION_PROMPT_VERSION = 'extraction@1';

const outputSchema: z.ZodType<ExtractionOutput> = z.object({
	facts: z
		.array(z.object({ text: textSchema(500), evidence: refListSchema }))
		.max(20)
		.describe('statements the cited articles report as fact'),
	claims: z
		.array(z.object({ claimant: textSchema(200), claim: textSchema(500), evidence: refListSchema }))
		.max(20)
		.describe('statements made by a named party'),
	occurred_at: isoInstantSchema
		.nullable()
		.default(null)
		.describe('only when an article states the exact time with a timezone; otherwise null'),
	countries: z.array(countrySchema).max(12).default([]),
	sensitive: z
		.boolean()
		.describe('true for armed conflict, contested territory, elections or other disputed topics'),
	open_questions: z.array(textSchema(300)).max(10).default([])
});

export const extractionTask = defineTask({
	task: 'extraction',
	promptVersion: EXTRACTION_PROMPT_VERSION,
	instructions: `Task: extract the event that the articles in <data>.articles report.
- facts: short English statements that the articles report as established. Each lists the refs of the articles that support it in "evidence" (at least one).
- claims: statements made by a specific party (government, official, group, person). "claimant" names who said it; "claim" is what they said; "evidence" lists supporting refs. Keep opposing claims separate.
- occurred_at: null unless an article states the exact time of the event with a timezone. Never guess a time or date.
- countries: ISO 3166-1 alpha-2 codes.
- sensitive: true for contested conflicts or disputed political topics.
- open_questions: what remains unclear or disputed.`,
	outputSchema,
	findUnknownRefs(output, input) {
		const refs = new Set(input.articles.map((article) => article.ref));
		return [
			...output.facts.flatMap((fact, i) =>
				unknownRefIssues(fact.evidence, refs, `facts.${i}.evidence`)
			),
			...output.claims.flatMap((claim, i) =>
				unknownRefIssues(claim.evidence, refs, `claims.${i}.evidence`)
			)
		];
	}
});
