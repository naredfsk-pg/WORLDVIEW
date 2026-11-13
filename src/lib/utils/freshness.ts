import type { IsoUtc } from '../types/domain';
import type { Freshness } from '../types/views';

/** No successful ingest for this long → stale. 9 h covers the 23:00 → 06:00 ICT gap (ARCHITECTURE §15). */
export const STALE_AFTER_MS = 9 * 60 * 60 * 1000;

/** Pure staleness rule shared by the root layout and `/health`. */
export function computeFreshness(
	timestamps: { last_ingest_succeeded_at: IsoUtc | null; last_brief_published_at: IsoUtc | null },
	now: Date
): Freshness {
	const lastIngest = timestamps.last_ingest_succeeded_at;
	const stale = lastIngest === null || now.getTime() - Date.parse(lastIngest) >= STALE_AFTER_MS;
	return { ...timestamps, stale };
}
