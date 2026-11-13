import { error } from '@sveltejs/kit';
import { ACADEMY_WEEKS } from '#lib/content/academy.js';
import { getLessonDetail, listLessonSummaries } from '#lib/content/academy.server.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { LessonPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

const RELATED_EVENT_LIMIT = 5;
/** One canonical form: no leading zeros, so `/day/01` is a 404 rather than a duplicate of `/day/1`. */
const CANONICAL_NUMBER = /^[1-9]\d?$/;

/**
 * `/academy/week/[week]/day/[day]`: `day` is global 1–30 and must belong to `week`, else 404.
 * Week and day must be written without leading zeros.
 */
export const load: PageServerLoad = async ({ params }): Promise<LessonPageData> => {
	const week = ACADEMY_WEEKS.find((item) => String(item.week) === params.week);
	const lesson =
		week && CANONICAL_NUMBER.test(params.day)
			? getLessonDetail(week.week, Number(params.day))
			: null;
	if (!week || !lesson) error(404, 'ไม่พบบทเรียนนี้');

	const summaries = listLessonSummaries();
	const index = summaries.findIndex((item) => item.id === lesson.id);
	return {
		lesson,
		week,
		prev: summaries[index - 1] ?? null,
		next: summaries[index + 1] ?? null,
		related_events: await getRepositories().read.listPublishedEventsForLesson(
			lesson.id,
			RELATED_EVENT_LIMIT
		)
	};
};
