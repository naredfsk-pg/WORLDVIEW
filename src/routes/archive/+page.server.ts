import { isBriefDate, isYearMonth, monthOf } from '#lib/utils/date.js';
import { parseCategory } from '#lib/utils/params.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { REGION_SLUGS } from '#lib/types/domain.js';
import type { ArchivePageData } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

/**
 * `/archive?month=&date=&category=&region=`. Invalid params fall back to defaults (no 400).
 * A valid `date` wins over `month`; with no date the latest brief in the month is selected.
 * Category/region filtering happens in the page so the SSR output matches the URL.
 */
export const load: PageServerLoad = async ({ url, parent }): Promise<ArchivePageData> => {
	const { read } = getRepositories();
	const dateParam = url.searchParams.get('date');
	const monthParam = url.searchParams.get('month');
	const requestedDate = isBriefDate(dateParam) ? dateParam : null;

	let month;
	if (requestedDate) {
		month = monthOf(requestedDate);
	} else if (isYearMonth(monthParam)) {
		month = monthParam;
	} else {
		const latest = await read.getLatestPublishedBriefDate();
		month = monthOf(latest ?? (await parent()).today);
	}

	const availableDates = await read.listBriefDatesInMonth(month);
	const selectedDate = requestedDate ?? availableDates.at(-1) ?? null;
	const brief = selectedDate ? await read.getPublishedBrief(selectedDate) : null;
	const regionParam = url.searchParams.get('region');

	return {
		month,
		available_dates: availableDates,
		selected_date: selectedDate,
		brief,
		category: parseCategory(url.searchParams.get('category')),
		region: REGION_SLUGS.find((slug) => slug === regionParam) ?? null
	};
};
