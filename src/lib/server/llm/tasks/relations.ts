/** `relations`: typed links between one event and candidate events, each with evidence refs. */
import { z } from 'zod';
import { RELATION_TYPES } from '../../../types/domain';
import type { RelationsOutput } from '../../../types/llm';
import {
	confidenceSchema,
	defineTask,
	refListSchema,
	refSchema,
	textSchema,
	unknownRefIssues
} from './shared';

export const RELATIONS_PROMPT_VERSION = 'relations@1';

const outputSchema: z.ZodType<RelationsOutput> = z.object({
	relations: z
		.array(
			z.object({
				candidate_ref: refSchema,
				relation_type: z.enum(RELATION_TYPES),
				direction: z.enum(['event_to_candidate', 'candidate_to_event']),
				explanation_th: textSchema(600),
				evidence: refListSchema.describe('article refs from the event or that candidate'),
				confidence: confidenceSchema
			})
		)
		.max(8)
});

export const relationsTask = defineTask({
	task: 'relations',
	promptVersion: RELATIONS_PROMPT_VERSION,
	instructions: `Task: find relations between <data>.event and each event in <data>.candidates. Return [] when none is clearly supported.
Allowed relation_type values (read as "from <type> to"):
- same_topic: both cover the same ongoing topic.
- follow_up: "from" is a later development of "to".
- response_to: "from" is a stated response to "to". Only when an article says so.
- background_of: "from" is background needed to understand "to".
- potential_impact: "from" may affect "to". Only when an article says so; it is a possibility, never a confirmed cause.
Rules:
- Never assert causation from your own reasoning. Every relation needs "evidence": refs of articles (of the event or that candidate) that support it.
- direction: "event_to_candidate" means from = event, to = candidate.
- explanation_th: one neutral Thai sentence; for potential_impact use wording such as "อาจส่งผล".
- confidence: 0 to 1.`,
	outputSchema,
	findUnknownRefs(output, input) {
		const eventRefs = input.event.articles.map((article) => article.ref);
		const candidatesByRef = new Map(
			input.candidates.map((candidate) => [candidate.ref, candidate])
		);

		return output.relations.flatMap((relation, i) => {
			const candidate = candidatesByRef.get(relation.candidate_ref);
			if (!candidate) return [`relations.${i}.candidate_ref: unknown ref`];

			const allowed = new Set([...eventRefs, ...candidate.articles.map((article) => article.ref)]);
			return unknownRefIssues(relation.evidence, allowed, `relations.${i}.evidence`);
		});
	}
});
