/** `#lib/server/editorial`: pure publishing gates (ARCHITECTURE §11). */
export {
	evaluateEventForPublish,
	reviewReasonForLlmError,
	countDistinctSources,
	mapRefsToArticleIds
} from './event-gate';
export { evaluateRelation } from './relation-gate';
export { selectLessonLinks, MAX_LESSON_LINKS } from './lesson-links';
export { containsContact, containsLinkOrContact, containsUrl, isThaiText } from './text';
export { filterAllegationTags, isAllegationTag } from './tag-filter';
export { buildEventUpdate, type EventUpdateWrite } from './event-update';
