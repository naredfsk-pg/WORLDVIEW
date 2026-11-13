/**
 * Academy link filter (PRD §5.2: "only existing IDs"). Keeps a link only when its `lesson_id` is
 * one of the existing lessons and its rationale is Thai with no URL or contact details; removes duplicates and keeps
 * at most 3. Independent of the provider's own lesson-id check (defence in depth).
 */
import type { AcademyLinkingOutput } from '../../types/llm';
import { containsLinkOrContact, isThaiText } from './text';

export const MAX_LESSON_LINKS = 3;

type LessonLink = AcademyLinkingOutput['links'][number];

export function selectLessonLinks(
	links: readonly LessonLink[],
	allowedLessonIds: ReadonlySet<string>
): LessonLink[] {
	const selected: LessonLink[] = [];
	for (const link of links) {
		if (selected.length === MAX_LESSON_LINKS) break;
		if (!allowedLessonIds.has(link.lesson_id)) continue;
		if (!isThaiText(link.rationale_th) || containsLinkOrContact(link.rationale_th)) continue;
		if (selected.some((existing) => existing.lesson_id === link.lesson_id)) continue;
		selected.push(link);
	}
	return selected;
}
