/** `tagging`: category, regions, countries and tags per article (closed sets only). */
import { z } from 'zod';
import { CATEGORY_SLUGS, REGION_SLUGS } from '../../../types/domain';
import type { TaggingOutput } from '../../../types/llm';
import { countrySchema, defineTask, refSchema, tagSchema, unknownRefIssues } from './shared';

export const TAGGING_PROMPT_VERSION = 'tagging@1';

const outputSchema: z.ZodType<TaggingOutput> = z.object({
	items: z.array(
		z.object({
			ref: refSchema.describe('ref of the article being tagged'),
			category: z.enum(CATEGORY_SLUGS),
			regions: z.array(z.enum(REGION_SLUGS)).max(REGION_SLUGS.length),
			countries: z.array(countrySchema).max(12).default([]),
			tags: z.array(tagSchema).max(8).describe('kebab-case English topic keywords')
		})
	)
});

export const taggingTask = defineTask({
	task: 'tagging',
	promptVersion: TAGGING_PROMPT_VERSION,
	instructions: `Task: tag each article in <data>.articles. Return one item per article, using its ref.
- category: the single best fit from the allowed values.
- regions: the regions the story is about ("global" only for genuinely worldwide stories).
- countries: ISO 3166-1 alpha-2 codes of countries the article is clearly about; [] if none.
- tags: up to 8 short kebab-case English keywords (for example "nato", "interest-rates").
Base the tags only on the title and excerpt.`,
	outputSchema,
	findUnknownRefs(output, input) {
		const refs = new Set(input.articles.map((article) => article.ref));
		return unknownRefIssues(
			output.items.map((item) => item.ref),
			refs,
			'items.ref'
		);
	}
});
