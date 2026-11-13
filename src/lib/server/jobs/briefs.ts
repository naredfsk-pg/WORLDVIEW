/**
 * `brief_morning`, `brief_evening` and `archive_snapshot` (ARCHITECTURE §8). One body for all
 * three: candidates of the edition window → rank with the region quota → `saveBrief`, which
 * upserts on (brief_date, edition) and replaces the items in one transaction, so reruns never
 * duplicate and an admin-hidden brief stays hidden. A brief with no eligible event is a `draft`.
 *
 * `archive_snapshot` builds the `daily_snapshot` of a past Bangkok day (FR-03: a superset of what
 * readers saw that day): every event of that day's published morning and evening briefs is kept,
 * outside the cap and the quota, and the remaining slots up to MAX are ranked from the day's
 * window. Evidence time is `published_at ?? ingested_at`, so a late report about day D (ingested
 * on D+2, published on D) joins D's snapshot on `archive_snapshot --date D --force`.
 *
 * A brief with no item, or fewer than MIN, makes the run `partial` (exit 2) so the shortfall is
 * visible; a run that finds nothing never takes down a brief that is already published.
 */
import type { BriefDate, BriefEdition } from '#lib/types/domain.js';
import type { BriefWindow, JobContext, JobOutcome } from '#lib/types/jobs.js';
import type { BriefCandidate, BriefRepository } from '#lib/types/repositories.js';
import { addDays, bangkokDateTimeToUtc, bangkokDayRangeUtc } from '#lib/utils/date.js';
import { rankBriefCandidates } from './brief-ranking.js';

export interface BriefDeps {
	briefs: BriefRepository;
	/** DAILY_EVENT_TARGET_MIN / MAX: at most `max` items; fewer than `min` is logged, never padded. */
	target: { min: number; max: number };
}

export async function runBrief(
	deps: BriefDeps,
	ctx: JobContext,
	brief: { date: BriefDate; edition: BriefEdition }
): Promise<JobOutcome> {
	const window = briefWindow(brief.date, brief.edition);
	const candidates = await deps.briefs.listCandidateEvents({
		start_utc: window.start_utc,
		end_utc: window.end_utc,
		...(brief.edition === 'daily_snapshot' ? { include_briefs_of: brief.date } : {})
	});
	// Fictional demo events never share a brief with real news; they only fill an empty dev DB.
	const realCandidates = candidates.filter((candidate) => !candidate.is_demo);
	const pool = realCandidates.length > 0 ? realCandidates : candidates;

	const items =
		brief.edition === 'daily_snapshot'
			? snapshotItems(pool, deps.target.max, window.end_utc)
			: rankBriefCandidates(pool, { max: deps.target.max, windowEnd: window.end_utc });
	await deps.briefs.saveBrief({
		brief_date: brief.date,
		edition: brief.edition,
		status: items.length > 0 ? 'published' : 'draft',
		generated_at: ctx.now().toISOString(),
		items
	});

	const fields = { brief_date: brief.date, edition: brief.edition, events: items.length };
	const belowTarget = items.length < deps.target.min;
	if (belowTarget) ctx.logger.warn('brief below the daily target', fields);
	else ctx.logger.info('brief saved', fields);
	return {
		status: belowTarget ? 'partial' : 'succeeded',
		counters: { brief_candidates: pool.length, brief_events: items.length },
		error: belowTarget
			? `${items.length} events, below DAILY_EVENT_TARGET_MIN ${deps.target.min}`
			: null
	};
}

/** Carried brief items first (all of them), then the best window events in the slots left. */
function snapshotItems(
	pool: BriefCandidate[],
	max: number,
	windowEnd: string
): ReturnType<typeof rankBriefCandidates> {
	const carried = pool.filter((candidate) => candidate.in_day_briefs);
	const others = pool.filter((candidate) => !candidate.in_day_briefs);
	return [
		...rankBriefCandidates(carried, { max: carried.length, windowEnd }),
		...rankBriefCandidates(others, { max: Math.max(0, max - carried.length), windowEnd })
	].map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * `[start, end)` in UTC (ARCHITECTURE §8):
 * morning D = D-1 07:00 → D 07:00 ICT · evening D = D-1 19:00 → D 19:00 ICT ·
 * daily_snapshot D = D 00:00 → D+1 00:00 ICT.
 */
export function briefWindow(date: BriefDate, edition: BriefEdition): BriefWindow {
	if (edition === 'daily_snapshot')
		return { brief_date: date, edition, ...bangkokDayRangeUtc(date) };
	const time = edition === 'morning' ? '07:00' : '19:00';
	return {
		brief_date: date,
		edition,
		start_utc: bangkokDateTimeToUtc(addDays(date, -1), time),
		end_utc: bangkokDateTimeToUtc(date, time)
	};
}
