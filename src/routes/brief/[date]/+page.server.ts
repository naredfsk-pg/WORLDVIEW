import { error } from '@sveltejs/kit';
import { isBriefDate, parseEdition } from '#lib/components/format.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { BriefPageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

/** `/brief/[date]?edition=`: no edition → best one (daily_snapshot > evening > morning). */
export const load: PageServerLoad = async ({ params, url }): Promise<BriefPageData> => {
	const date = params.date;
	if (!isBriefDate(date)) error(404, 'ไม่พบสรุปข่าวของวันที่นี้');

	const editionParam = url.searchParams.get('edition');
	const edition = parseEdition(editionParam);
	if (editionParam !== null && edition === null) error(404, 'ไม่พบสรุปข่าวรอบนี้');

	const { read } = getRepositories();
	const brief = await read.getPublishedBrief(date, edition ?? undefined);
	if (!brief) error(404, 'ไม่พบสรุปข่าวของวันที่นี้');

	const [editions, adjacent] = await Promise.all([
		read.listPublishedEditions(date),
		read.getAdjacentBriefDates(date)
	]);
	return {
		date,
		brief,
		editions_available: editions,
		prev_date: adjacent.prev,
		next_date: adjacent.next
	};
};
