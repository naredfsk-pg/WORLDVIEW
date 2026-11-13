import { redirect } from '@sveltejs/kit';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { PageServerLoad } from './$types';

/** `/brief` → the latest published brief, or home when there is none yet. */
export const load: PageServerLoad = async () => {
	const latest = await getRepositories().read.getLatestPublishedBriefDate();
	redirect(307, latest ? `/brief/${latest}` : '/');
};
