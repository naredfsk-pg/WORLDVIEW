/** `summary`: the neutral Thai event text (FR-02 fields) plus ranking signals and cited refs. */
import { z } from 'zod';
import { CREDIBILITY_LEVELS } from '../../../types/domain';
import type { SummaryOutput } from '../../../types/llm';
import {
	defineTask,
	MAX_ARTICLES_PER_CALL,
	refListSchema,
	textSchema,
	unknownRefIssues
} from './shared';

// summary@2 (Wave 2 review): title and summary state only facts every source agrees on.
// summary@3 (Wave 3): allegations about a person stay attributed claims; optional `update_th`
// (one timeline line on what the new articles add) and `previous.new_refs` in the input.
// summary@4 (Wave 3 review): `update_refs` ties the line to its evidence; both timeline fields
// are lenient, so a bad value only drops the timeline row and never fails the summary.
// summary@5 (auto-publish wave): `credibility_level` + `credibility_reason_th`, the public label
// of the claims (never the outlet). Lenient too: a bad value means no label from the model, and
// the deterministic floor still applies (`assessCredibility`).
export const SUMMARY_PROMPT_VERSION = 'summary@5';

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
	cited_refs: refListSchema.describe('refs of every article the text relies on'),
	update_th: textSchema(300)
		.nullable()
		.default(null)
		.catch(null)
		.describe('one Thai line on what previous.new_refs add, or null'),
	update_refs: refListSchema
		.default([])
		.catch([])
		.describe('the refs from previous.new_refs that update_th is based on'),
	credibility_level: z
		.enum(CREDIBILITY_LEVELS)
		.default('none')
		.catch('none')
		.describe('credibility of the claims in the event, never of the outlet'),
	credibility_reason_th: textSchema(200)
		.nullable()
		.default(null)
		.catch(null)
		.describe('one neutral Thai sentence on why the level applies; null for none')
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
- Allegations about a named person (their private life or relationships, or criminal, corruption, espionage or sexual-misconduct allegations) are claims, never facts: put them in claims_th with who makes them, mark them as unconfirmed, and keep title_th and summary_th to what is confirmed (if the allegation is the core of the news, attribute it there too, e.g. "ตามรายงานของ …").
- impact_breadth and thailand_relevance: integers 0-3.
- cited_refs: refs of every article your text relies on (at least one).
If <data>.previous is not null, keep its wording where the facts have not changed.
- update_th: when <data>.previous is not null and previous.new_refs is not empty, one short Thai sentence (a timeline entry, at most 300 characters) saying what the articles in previous.new_refs add to the story, with the same attribution rules; otherwise null. Use null when they add nothing new.
- update_refs: the refs from previous.new_refs that update_th is based on (at least one when update_th is not null); [] when update_th is null.
- credibility_level: how well the CLAIMS in this event are supported by the supplied articles. Judge only the content of <data>; never judge an outlet by its name or reputation, and never accuse a news organisation of lying or bias. Use exactly one of:
  - "none": the main facts are reported consistently and nothing below applies (the usual case).
  - "unverified": a sensitive or contested claim rests on a single article, the key claim comes only from one involved party, or an article itself says the claim could not be independently verified.
  - "disputed": the articles report conflicting facts or figures (for example different casualty numbers, or one says an event happened and another denies it).
  - "possible_misinformation": only with a clear signal in the data: a claim is contradicted by another supplied article, an article reports the claim was debunked or shown to be false, or it is viral material that no article could verify. Never use it on suspicion alone.
- credibility_reason_th: when credibility_level is not "none", one short neutral Thai sentence (at most 200 characters) on what is unconfirmed or conflicting, e.g. "ตัวเลขผู้เสียชีวิตในรายงานแต่ละแหล่งไม่ตรงกัน"; describe the claim, not the outlet; no links, names of websites or contact details. null when credibility_level is "none".`,
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
