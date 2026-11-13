/** `clustering`: same / related / unrelated suggestions for ambiguous article–event pairs. */
import { z } from 'zod';
import type { ClusteringOutput } from '../../../types/llm';
import { confidenceSchema, defineTask, refSchema, unknownRefIssues } from './shared';

export const CLUSTERING_PROMPT_VERSION = 'clustering@1';

const outputSchema: z.ZodType<ClusteringOutput> = z.object({
	decisions: z.array(
		z.object({
			pair_ref: refSchema,
			verdict: z.enum(['same_event', 'related', 'unrelated']),
			confidence: confidenceSchema
		})
	)
});

export const clusteringTask = defineTask({
	task: 'clustering',
	promptVersion: CLUSTERING_PROMPT_VERSION,
	instructions: `Task: for each pair in <data>.pairs, decide whether "a" and "b" report the same real-world event.
- same_event: the same specific happening (same actors, place and time frame).
- related: the same broader topic or story line, but a different happening.
- unrelated: anything else.
- confidence: 0 to 1. When unsure between same_event and related, choose related with low confidence; a wrong merge is worse than a duplicate.
Return one decision per pair, using its pair_ref.`,
	outputSchema,
	findUnknownRefs(output, input) {
		const refs = new Set(input.pairs.map((pair) => pair.pair_ref));
		return unknownRefIssues(
			output.decisions.map((decision) => decision.pair_ref),
			refs,
			'decisions.pair_ref'
		);
	}
});
