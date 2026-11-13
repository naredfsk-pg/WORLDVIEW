import type { BriefDate, IsoUtc } from '#lib/types/domain.js';

export const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Asia/Bangkok is fixed at UTC+7 with no DST (ARCHITECTURE §7). */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Start of the `/connections` window: 30 days before the latest published brief day (Bangkok
 * midnight), so the list follows the data rather than the wall clock and does not go empty when
 * publishing pauses. With no brief yet, 30 days before `now`.
 */
export function relationWindowStart(latestBriefDate: BriefDate | null, now: Date): IsoUtc {
	if (!latestBriefDate) return new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();

	const [year, month, day] = latestBriefDate.split('-').map(Number) as [number, number, number];
	const startOfWindow = Date.UTC(year, month - 1, day - WINDOW_DAYS) - BANGKOK_OFFSET_MS;
	return new Date(startOfWindow).toISOString();
}
