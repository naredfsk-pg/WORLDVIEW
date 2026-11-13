import { parseCategory } from '#lib/utils/params.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { ConnectionsPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';
import { relationWindowStart } from './window';

const RELATION_LIMIT = 50;

/**
 * `/connections?category=`: published relations from the 30 days up to the latest published brief
 * (MVP list; graph is Phase 2). Anchored to the data, not the wall clock.
 */
export const load: PageServerLoad = async ({ url }): Promise<ConnectionsPageData> => {
	const { read } = getRepositories();
	const category = parseCategory(url.searchParams.get('category'));
	const latestBriefDate = await read.getLatestPublishedBriefDate();
	const relations = await read.listPublishedRelations({
		since: relationWindowStart(latestBriefDate, new Date()),
		category,
		limit: RELATION_LIMIT
	});
	return { relations, category };
};
