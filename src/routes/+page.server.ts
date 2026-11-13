import { listLessonSummaries } from '#lib/content/academy.server.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { TodayPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

/** `/`: today's brief if one is published (best edition), otherwise the most recent one. */
export const load: PageServerLoad = async ({ parent }): Promise<TodayPageData> => {
	const { today } = await parent();
	const { read } = getRepositories();

	const todaysBrief = await read.getPublishedBrief(today);
	if (todaysBrief) {
		return { brief: todaysBrief, brief_is_today: true, lessons: listLessonSummaries() };
	}

	const latestDate = await read.getLatestPublishedBriefDate();
	const latestBrief = latestDate ? await read.getPublishedBrief(latestDate) : null;
	return { brief: latestBrief, brief_is_today: false, lessons: listLessonSummaries() };
};
