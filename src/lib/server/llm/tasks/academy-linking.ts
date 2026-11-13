/** `academy_linking`: up to 3 Academy lessons that explain an event, chosen from the supplied list. */
import { z } from 'zod';
import type { AcademyLinkingOutput } from '../../../types/llm';
import { defineTask, refSchema, textSchema, unknownRefIssues } from './shared';

export const ACADEMY_LINKING_PROMPT_VERSION = 'academy_linking@1';

const outputSchema: z.ZodType<AcademyLinkingOutput> = z.object({
	links: z.array(z.object({ lesson_id: refSchema, rationale_th: textSchema(400) })).max(3)
});

export const academyLinkingTask = defineTask({
	task: 'academy_linking',
	promptVersion: ACADEMY_LINKING_PROMPT_VERSION,
	instructions: `Task: choose at most 3 lessons from <data>.lessons that help a reader understand <data>.event. Return [] if none fits.
- lesson_id: copied exactly from <data>.lessons. Never invent an id.
- rationale_th: one neutral Thai sentence on what background the lesson gives for this event.`,
	outputSchema,
	findUnknownRefs(output, input) {
		const lessonIds = new Set(input.lessons.map((lesson) => lesson.lesson_id));
		return unknownRefIssues(
			output.links.map((link) => link.lesson_id),
			lessonIds,
			'links.lesson_id'
		);
	}
});
