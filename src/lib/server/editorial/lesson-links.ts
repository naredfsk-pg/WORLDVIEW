/**
 * Academy link filter. The provider already rejects lesson ids that were not supplied; this drops
 * links whose rationale is not Thai or contains a URL, removes duplicates, and keeps at most 3.
 */
import type { AcademyLinkingOutput } from '../../types/llm';
import { containsUrl, isThaiText } from './text';

export const MAX_LESSON_LINKS = 3;

type LessonLink = AcademyLinkingOutput['links'][number];

export function selectLessonLinks(links: readonly LessonLink[]): LessonLink[] {
	const selected: LessonLink[] = [];
	for (const link of links) {
		if (selected.length === MAX_LESSON_LINKS) break;
		if (!isThaiText(link.rationale_th) || containsUrl(link.rationale_th)) continue;
		if (selected.some((existing) => existing.lesson_id === link.lesson_id)) continue;
		selected.push(link);
	}
	return selected;
}
