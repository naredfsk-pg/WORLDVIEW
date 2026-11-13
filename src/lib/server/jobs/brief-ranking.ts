/**
 * Brief ranking (ARCHITECTURE §8, PRD §4.4). Pure. A configurable editorial heuristic, not a
 * measure of truth:
 *
 *   score = 3·impact_breadth + 3·thailand_relevance        (0–3 each, from the summary)
 *         + 2·recency          (newest evidence inside the window: 1 at the window end, 0 a day
 *                                 earlier; later reports never count, so a forced rerun of a past
 *                                 day ranks as it would have at the time)
 *         + 1.5·continuing     (has updates or a published relation to an older event)
 *         + diversity          (distinct publishers − 1, capped at 3)
 *
 * Source credibility is not scored separately: every source is an owner-approved outlet or
 * public body, so diversity is the signal that varies.
 *
 * Top slots (security review #3): impact and Thailand relevance come only from the LLM, which a
 * prompt-injected article can steer to 3/3. So the first `CORROBORATED_TOP_SLOTS` ranks go to
 * events reported by at least two registry sources (`source_count`), best score first, whenever
 * the brief has such events; the other items follow in score order. Which events enter the brief
 * is unchanged.
 *
 * Region quota: no region (other than `global`) may take more than 40% of the items while other
 * candidates are left, so US/Europe news cannot crowd out every other region. Leftover slots are
 * then filled in score order. At most `max` items; never padded.
 */
import { REGION_LABEL_TH, type IsoUtc, type RegionSlug } from '#lib/types/domain.js';
import type { BriefCandidate } from '#lib/types/repositories.js';

export const REGION_MAX_SHARE = 0.4;
/** Ranks reserved for corroborated events (≥ 2 registry sources), when the brief has any. */
export const CORROBORATED_TOP_SLOTS = 3;
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
				b.evidenceMs - a.evidenceMs ||
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

	const byScore = picked.sort(
		(a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id)
	);
	const top = byScore
		.filter((entry) => entry.candidate.source_count >= 2)
		.slice(0, CORROBORATED_TOP_SLOTS);
	return [...top, ...byScore.filter((entry) => !top.includes(entry))].map((entry, index) => ({
		event_id: entry.candidate.id,
		rank: index + 1,
		selection_reason: selectionReason(entry, balancing.has(entry.candidate.id))
	}));
}

function scoreCandidate(
	candidate: BriefCandidate,
	windowEnd: IsoUtc
): { score: number; recency: number; evidenceMs: number } {
	const impact = candidate.signals?.impact_breadth ?? 0;
	const thailand = candidate.signals?.thailand_relevance ?? 0;
	const windowEndMs = Date.parse(windowEnd);
	// An event carried in by a brief may have no evidence inside the window: use what it had by then.
	const evidenceMs = Math.min(
		windowEndMs,
		Date.parse(candidate.window_evidence_at ?? candidate.last_updated_at)
	);
	const ageMs = windowEndMs - evidenceMs;
	const recency = Math.max(0, 1 - ageMs / RECENCY_HORIZON_MS);
	const diversity = Math.min(Math.max(candidate.source_count, 1), 4) - 1;
	const score =
		3 * impact + 3 * thailand + 2 * recency + (candidate.is_continuing ? 1.5 : 0) + diversity;
	return { score, recency, evidenceMs };
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
