/**
 * Public credibility label (ARCHITECTURE §11, owner decision 2026-11-13). Pure.
 *
 * The label describes the claims in an event, never the outlet. The summary task proposes a level
 * and a one-sentence Thai reason; this function adds the deterministic floor and cleans the
 * reason. It never blocks publishing: a reason that fails the Thai or G3 checks is dropped, the
 * level is kept.
 */
import { CREDIBILITY_LEVELS, type CredibilityLevel, type NewsEvent } from '../../types/domain';
import { containsLinkOrContact, isThaiText } from './text';

/** Shown when only the floor (sensitive topic, one registry source) sets the label. */
export const SINGLE_SOURCE_FLOOR_REASON_TH =
	'เป็นประเด็นอ่อนไหวที่มีรายงานจากแหล่งข่าวเดียว ยังไม่มีแหล่งข่าวอื่นยืนยัน';

export type Credibility = Pick<NewsEvent, 'credibility_level' | 'credibility_reason_th'>;

export interface CredibilityInput {
	/** The model's (or stored) assessment; null when there is none. */
	assessed: { level: CredibilityLevel; reason_th: string | null } | null;
	/** `signals.sensitive` or extraction `sensitive`. */
	sensitive: boolean;
	/** Distinct registry sources (`countDistinctSources`). */
	distinct_sources: number;
}

export function assessCredibility(input: CredibilityInput): Credibility {
	const assessedLevel = input.assessed?.level ?? 'none';
	const floor: CredibilityLevel =
		input.sensitive && input.distinct_sources < 2 ? 'unverified' : 'none';
	const level = rank(floor) > rank(assessedLevel) ? floor : assessedLevel;
	if (level === 'none') return { credibility_level: 'none', credibility_reason_th: null };

	// The model's reason explains the model's level; when the floor raised it, use the fixed line.
	if (level !== assessedLevel) {
		return { credibility_level: level, credibility_reason_th: SINGLE_SOURCE_FLOOR_REASON_TH };
	}
	const reason = input.assessed?.reason_th?.trim() ?? '';
	if (isThaiText(reason) && !containsLinkOrContact(reason)) {
		return { credibility_level: level, credibility_reason_th: reason };
	}
	const fallback = level === floor ? SINGLE_SOURCE_FLOOR_REASON_TH : null;
	return { credibility_level: level, credibility_reason_th: fallback };
}

function rank(level: CredibilityLevel): number {
	return CREDIBILITY_LEVELS.indexOf(level);
}
