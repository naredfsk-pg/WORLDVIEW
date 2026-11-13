/** `clustering`: same / related / unrelated suggestions for ambiguous article–event pairs. */
import { z } from 'zod';
import type { ClusteringOutput } from '../../../types/llm';
import { confidenceSchema, defineTask, refSchema, textSchema, unknownRefIssues } from './shared';

// clustering@2 (Wave 3): other happenings of the same trip or story line are only related.
// clustering@3 (Wave 3 review): same_event is the same happening only; reactions, consequences
// and follow-ups are related (they become relations, FR-04). Adds the optional rationale_th.
export const CLUSTERING_PROMPT_VERSION = 'clustering@3';

const outputSchema: z.ZodType<ClusteringOutput> = z.object({
	decisions: z.array(
		z.object({
			pair_ref: refSchema,
			verdict: z.enum(['same_event', 'related', 'unrelated']),
			confidence: confidenceSchema,
			rationale_th: textSchema(300)
				.nullable()
				.default(null)
				.catch(null)
				.describe('one short Thai sentence: why')
		})
	)
});

export const clusteringTask = defineTask({
	task: 'clustering',
	promptVersion: CLUSTERING_PROMPT_VERSION,
	instructions: `Task: for each pair in <data>.pairs, decide whether "a" and "b" report the same real-world event.
- same_event: both report the same specific happening (the same core actors, place and time frame), such as two outlets reporting one announcement, attack, meeting or resignation.
- related: the same broader topic or story line, but a different happening. Reactions, consequences, investigations and other follow-ups of a happening are related, not same_event; so are another stop, meeting, speech or announcement during the same trip or visit, and a separate decision by the same actor.
- rationale_th: one short Thai sentence saying why, without URLs.
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
