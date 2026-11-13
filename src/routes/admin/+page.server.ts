import { getConfig } from '#lib/server/config.js';
import { getRepositories } from '#lib/server/db/repositories/index.js';
import type { AdminDashboardData } from '#lib/types/views.js';
import { toBriefDate } from '#lib/utils/date.js';
import { computeFreshness } from '#lib/utils/freshness.js';
import { requireAdmin } from './admin-forms.server';
import type { PageServerLoad } from './$types';

const RECENT_JOB_RUNS = 10;

/** `/admin`: job runs, provider health, LLM usage today (Bangkok day), freshness, review backlog. */
export const load: PageServerLoad = async ({ locals }): Promise<AdminDashboardData> => {
	const admin = requireAdmin(locals);
	const { admin: adminRepo, jobs, read } = getRepositories();
	const now = new Date();
	const bangkokDayStart = new Date(`${toBriefDate(now.toISOString())}T00:00:00+07:00`);

	const [jobRuns, sources, reviewCounts, usage, timestamps] = await Promise.all([
		jobs.listRecent(RECENT_JOB_RUNS),
		adminRepo.listSourceHealth(),
		adminRepo.countReviewQueue(),
		adminRepo.llmUsageSince(bangkokDayStart.toISOString()),
		read.getFreshnessTimestamps()
	]);
	const { dailyMaxRequests, dailyMaxTokens } = getConfig().llm;

	return {
		admin,
		job_runs: jobRuns,
		sources,
		review_counts: reviewCounts,
		llm_usage: {
			requests_today: usage.requests,
			tokens_today: usage.tokens,
			failures_today: usage.failures,
			cache_hits_today: usage.cache_hits,
			max_requests: dailyMaxRequests,
			max_tokens: dailyMaxTokens
		},
		freshness: computeFreshness(timestamps, now)
	};
};
