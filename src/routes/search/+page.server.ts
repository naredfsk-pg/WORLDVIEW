import { redirect } from '@sveltejs/kit';
import { isBriefDate } from '#lib/utils/date.js';
import { parseCategory, parsePageNumber } from '#lib/utils/params.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import { REGION_SLUGS } from '#lib/types/domain.js';
import { SEARCH_SCOPES, type SearchPageData, type SearchQuery } from '#lib/types/views.js';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 100;
/** 50 pages × 20 = 1,000 results; also keeps the SQL OFFSET far from integer overflow. */
const MAX_PAGE = 50;

/**
 * `/search?q=&scope=&category=&region=&from=&to=&page=`; empty `q` → form only.
 * `page` is clamped to [1, MAX_PAGE]; a page past the last result redirects to the last page.
 */
export const load: PageServerLoad = async ({ url }): Promise<SearchPageData> => {
	const params = url.searchParams;
	const q = (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
	if (!q) return { query: null, results: null };

	const page = parsePageNumber(params.get('page'), MAX_PAGE);
	const from = params.get('from');
	const to = params.get('to');
	const region = params.get('region');
	const query: SearchQuery = {
		q,
		scope: SEARCH_SCOPES.find((scope) => scope === params.get('scope')) ?? 'all',
		category: parseCategory(params.get('category')),
		region: REGION_SLUGS.find((slug) => slug === region) ?? null,
		from: isBriefDate(from) ? from : null,
		to: isBriefDate(to) ? to : null,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	};

	const { read } = getRepositories();
	const none = { items: [], total: 0 };
	const [events, lessons] = await Promise.all([
		query.scope === 'lessons' ? none : read.searchEvents(query),
		query.scope === 'events' ? none : read.searchLessons(query)
	]);

	const lastPage = Math.max(1, Math.ceil(Math.max(events.total, lessons.total) / PAGE_SIZE));
	if (page > lastPage) {
		const target = new URL(url);
		target.searchParams.set('page', String(lastPage));
		redirect(307, `${target.pathname}${target.search}`);
	}

	return {
		query,
		results: {
			events: events.items,
			events_total: events.total,
			lessons: lessons.items,
			lessons_total: lessons.total
		}
	};
};
