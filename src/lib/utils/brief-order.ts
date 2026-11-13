/**
 * Brief top ranks and the credibility label (ARCHITECTURE §8, auto-publish wave). Pure and
 * isomorphic: the brief job applies it when it ranks, and the public read path applies it again,
 * because an event can be labelled `possible_misinformation` after its brief was built.
 */
import type { CredibilityLevel } from '../types/domain';

/** Ranks 1–3: kept for corroborated events, and never given to `possible_misinformation`. */
export const TOP_RANKS = 3;

/**
 * Keeps the order, but moves every `possible_misinformation` item below the top ranks. When fewer
 * than `TOP_RANKS` other items exist, the flagged items are left out instead of moving up.
 */
export function keepMisinformationOutOfTopRanks<T>(
	items: readonly T[],
	levelOf: (item: T) => CredibilityLevel
): T[] {
	const isFlagged = (item: T) => levelOf(item) === 'possible_misinformation';
	const others = items.filter((item) => !isFlagged(item));
	if (others.length < TOP_RANKS) return others;
	return [...others, ...items.filter(isFlagged)];
}
