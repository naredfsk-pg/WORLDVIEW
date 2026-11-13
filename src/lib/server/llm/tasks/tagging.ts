/** `tagging`: category, regions, countries and tags per article (closed sets only). */
import { z } from 'zod';
import { CATEGORY_SLUGS, REGION_SLUGS } from '../../../types/domain';
import type { TaggingOutput } from '../../../types/llm';
import {
	countrySchema,
	defineTask,
	MAX_ARTICLES_PER_TAGGING_CALL,
	refSchema,
	tagSchema,
	unknownRefIssues
} from './shared';

// tagging@2 (Wave 3, owner policy): tags name topics, never allegations about a person.
export const TAGGING_PROMPT_VERSION = 'tagging@2';

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
- Tags describe topics (organisations, places, sectors, policy areas such as "semiconductors" or "us-china"), never allegations about individuals: no tag for a named person's private life, or for criminal, corruption, espionage or sexual-misconduct allegations (not "extramarital-affair", "alleged-spy" or "<name>-scandal").
Base the tags only on the title and excerpt.`,
	outputSchema,
	maxArticles: MAX_ARTICLES_PER_TAGGING_CALL,
	findUnknownRefs(output, input) {
		const refs = new Set(input.articles.map((article) => article.ref));
		return unknownRefIssues(
			output.items.map((item) => item.ref),
			refs,
			'items.ref'
		);
	}
});
