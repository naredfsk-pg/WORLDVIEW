/** `summary`: the neutral Thai event text (FR-02 fields) plus ranking signals and cited refs. */
import { z } from 'zod';
import type { SummaryOutput } from '../../../types/llm';
import {
	defineTask,
	MAX_ARTICLES_PER_CALL,
	refListSchema,
	textSchema,
	unknownRefIssues
} from './shared';

// summary@2 (Wave 2 review): title and summary state only facts every source agrees on.
export const SUMMARY_PROMPT_VERSION = 'summary@2';

const scoreSchema = z.literal([0, 1, 2, 3]);

const outputSchema: z.ZodType<SummaryOutput> = z.object({
	title_th: textSchema(200),
	summary_th: textSchema(600),
	what_happened_th: textSchema(2000),
	why_it_matters_th: textSchema(2000),
	background_th: textSchema(2000).nullable().default(null),
	uncertain_th: textSchema(1000).nullable().default(null),
	claims_th: z
		.array(
			z.object({ claimant_th: textSchema(200), claim_th: textSchema(600), evidence: refListSchema })
		)
		.max(20)
		.default([]),
	impact_breadth: scoreSchema.describe('0 = local only … 3 = worldwide'),
	thailand_relevance: scoreSchema.describe('0 = none … 3 = direct effect on Thailand'),
	cited_refs: refListSchema.describe('refs of every article the text relies on')
});

export const summaryTask = defineTask({
	task: 'summary',
	promptVersion: SUMMARY_PROMPT_VERSION,
	instructions: `Task: write the Thai text for one news event, using only <data>.articles and <data>.extraction.
All *_th fields are in neutral, plain Thai (proper names may stay in their usual spelling).
- title_th: a short, factual headline that states only facts all supplied articles agree on.
- summary_th: one or two sentences; the same rule as title_th.
- Wording that only one outlet uses, or that sources disagree on (for example a person's role or a label such as "former"), is never stated as fact in title_th or summary_th: attribute it to the outlet ("ตามรายงานของ BBC …") or leave it out of the title.
- what_happened_th: only what the articles confirm (the extraction facts). No claims, no speculation.
- why_it_matters_th: impact and context in careful wording; possible effects are marked as possible, never certain.
- background_th: relevant background that the data supports, or null.
- uncertain_th: what is still unclear or disputed. If the data is insufficient, write "ไม่แน่ชัด".
- claims_th: each claim with claimant_th (who said it, in Thai) and claim_th; never restate a claim as fact. "evidence" lists the supporting refs.
- impact_breadth and thailand_relevance: integers 0-3.
- cited_refs: refs of every article your text relies on (at least one).
If <data>.previous is not null, keep its wording where the facts have not changed.`,
	outputSchema,
	maxArticles: MAX_ARTICLES_PER_CALL,
	findUnknownRefs(output, input) {
		const refs = new Set(input.articles.map((article) => article.ref));
		return [
			...unknownRefIssues(output.cited_refs, refs, 'cited_refs'),
			...output.claims_th.flatMap((claim, i) =>
				unknownRefIssues(claim.evidence, refs, `claims_th.${i}.evidence`)
			)
		];
	}
});
