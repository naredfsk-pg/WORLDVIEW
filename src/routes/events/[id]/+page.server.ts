import { error } from '@sveltejs/kit';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { EventPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

/** Published events only; draft / pending / hidden → 404 so existence does not leak. */
export const load: PageServerLoad = async ({ params }): Promise<EventPageData> => {
	const event = await getRepositories().read.getPublishedEventDetail(params.id);
	if (!event) error(404, 'ไม่พบเหตุการณ์นี้');
	return { event };
};
