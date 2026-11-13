import { parseCategory } from '#lib/components/format.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { ConnectionsPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

const WINDOW_DAYS = 30;
const RELATION_LIMIT = 50;

/** `/connections?category=`: published relations from the last 30 days (MVP list; graph is Phase 2). */
export const load: PageServerLoad = async ({ url }): Promise<ConnectionsPageData> => {
	const category = parseCategory(url.searchParams.get('category'));
	const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const relations = await getRepositories().read.listPublishedRelations({
		since,
		category,
		limit: RELATION_LIMIT
	});
	return { relations, category };
};
