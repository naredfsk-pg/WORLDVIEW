/**
 * Brief ranking (ARCHITECTURE §8, PRD §4.4). Pure. A configurable editorial heuristic, not a
 * measure of truth:
 *
 *   score = 3·impact_breadth + 3·thailand_relevance        (0–3 each, from the summary)
 *         + 2·recency          (1 at the window end, 0 for evidence a day older)
 *         + 1.5·continuing     (has updates or a published relation to an older event)
 *         + diversity          (distinct publishers − 1, capped at 3)
 *
 * Source credibility is not scored separately: every source is an owner-approved outlet or
 * public body, so diversity is the signal that varies.
 *
 * Region quota: no region (other than `global`) may take more than 40% of the items while other
 * candidates are left, so US/Europe news cannot crowd out every other region. Leftover slots are
 * then filled in score order. At most `max` items; never padded.
 */
import { REGION_LABEL_TH, type IsoUtc, type RegionSlug } from '#lib/types/domain.js';
import type { BriefCandidate } from '#lib/types/repositories.js';

export const REGION_MAX_SHARE = 0.4;
const RECENCY_HORIZON_MS = 24 * 60 * 60 * 1000;
/** Regions whose news usually dominates international feeds (PRD §4.4). */
const DOMINANT_REGIONS: ReadonlySet<RegionSlug> = new Set(['americas', 'europe']);
const MAX_REASON_PARTS = 3;
const FALLBACK_REASON = 'เป็นข่าวสำคัญที่มีรายงานในรอบนี้';

export interface RankedBriefItem {
	event_id: string;
	rank: number;
	selection_reason: string;
}

export function rankBriefCandidates(
	candidates: readonly BriefCandidate[],
	options: { max: number; windowEnd: IsoUtc }
): RankedBriefItem[] {
	const scored = candidates
		.map((candidate) => ({ candidate, ...scoreCandidate(candidate, options.windowEnd) }))
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.candidate.last_updated_at.localeCompare(a.candidate.last_updated_at) ||
				a.candidate.id.localeCompare(b.candidate.id)
		);

	const target = Math.min(options.max, scored.length);
	const regionCap = Math.max(1, Math.floor(REGION_MAX_SHARE * target));
	const perRegion = new Map<RegionSlug, number>();
	const picked: typeof scored = [];
	const deferred: typeof scored = [];
	for (const entry of scored) {
		if (picked.length === target) break;
		const regions = quotaRegions(entry.candidate);
		if (regions.some((region) => (perRegion.get(region) ?? 0) >= regionCap)) {
			deferred.push(entry);
			continue;
		}
		regions.forEach((region) => perRegion.set(region, (perRegion.get(region) ?? 0) + 1));
		picked.push(entry);
	}
	// The quota held US/Europe news back: the other-region picks of the first pass are why.
	const heldBackDominant = deferred.some((entry) =>
		quotaRegions(entry.candidate).some((region) => DOMINANT_REGIONS.has(region))
	);
	const balancing = new Set(heldBackDominant ? picked.map((entry) => entry.candidate.id) : []);
	// No other alternatives are left: the quota yields rather than leave slots empty.
	picked.push(...deferred.slice(0, target - picked.length));

	return picked
		.sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
		.map((entry, index) => ({
			event_id: entry.candidate.id,
			rank: index + 1,
			selection_reason: selectionReason(entry, balancing.has(entry.candidate.id))
		}));
}

function scoreCandidate(
	candidate: BriefCandidate,
	windowEnd: IsoUtc
): { score: number; recency: number } {
	const impact = candidate.signals?.impact_breadth ?? 0;
	const thailand = candidate.signals?.thailand_relevance ?? 0;
	const ageMs = Math.max(0, Date.parse(windowEnd) - Date.parse(candidate.last_updated_at));
	const recency = Math.max(0, 1 - ageMs / RECENCY_HORIZON_MS);
	const diversity = Math.min(Math.max(candidate.source_count, 1), 4) - 1;
	const score =
		3 * impact + 3 * thailand + 2 * recency + (candidate.is_continuing ? 1.5 : 0) + diversity;
	return { score, recency };
}

function quotaRegions(candidate: BriefCandidate): RegionSlug[] {
	return candidate.regions.filter((region) => region !== 'global');
}

/** Short Thai explanation from the strongest signals, e.g. "ผลกระทบในวงกว้าง · รายงานจาก 3 แหล่งข่าว". */
function selectionReason(
	entry: { candidate: BriefCandidate; recency: number },
	balancesRegions: boolean
): string {
	const { candidate, recency } = entry;
	const otherRegion = quotaRegions(candidate).find((region) => !DOMINANT_REGIONS.has(region));
	const parts = [
		(candidate.signals?.impact_breadth ?? 0) >= 2 ? 'ผลกระทบในวงกว้าง' : null,
		(candidate.signals?.thailand_relevance ?? 0) >= 2 ? 'เกี่ยวข้องกับประเทศไทยโดยตรง' : null,
		balancesRegions && otherRegion ? `ครอบคลุมข่าวจาก${REGION_LABEL_TH[otherRegion]}` : null,
		candidate.is_continuing ? 'เป็นเรื่องที่ติดตามต่อเนื่อง' : null,
		candidate.source_count >= 2 ? `รายงานจาก ${candidate.source_count} แหล่งข่าว` : null,
		recency >= 0.75 ? 'มีความคืบหน้าล่าสุดในรอบนี้' : null
	].filter((part) => part !== null);
	return parts.length > 0 ? parts.slice(0, MAX_REASON_PARTS).join(' · ') : FALLBACK_REASON;
}
