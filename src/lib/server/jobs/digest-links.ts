/**
 * Digest links step (ARCHITECTURE §9 digest order 5), for events published or re-summarized in
 * this run:
 * - relations: candidate published events → `relations` task → relation gate → upsert on `store`
 *   (no relation without evidence from the two events' own articles; causal types wait for a human)
 * - Academy: prefiltered lessons → `academy_linking` task → `selectLessonLinks` (existing ids only)
 *   → `replaceLessonLinks`
 * A failed LLM call stores nothing and keeps the previous links.
 */
import type { AcademyLessonRow, CategorySlug, NewsEvent, Tag } from '#lib/types/domain.js';
import type { JobCounters, Logger } from '#lib/types/jobs.js';
import type { EventRefInput } from '#lib/types/llm.js';
import type { ArticleWithSource } from '#lib/types/news.js';
import type { DigestRepository, EventWithArticles } from '#lib/types/repositories.js';
import { evaluateRelation, mapRefsToArticleIds, selectLessonLinks } from '../editorial/index.js';
import { toArticleRef, type RunTask } from './digest-llm.js';

/** ARCHITECTURE §9: up to 8 candidates from the last 14 days, and up to 8 prefiltered lessons. */
export const RELATION_CANDIDATE_LIMIT = 8;
export const RELATION_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const LESSON_CANDIDATE_LIMIT = 8;
/** Articles per event in a relations input, so 9 events stay small (titles only, no URLs). */
const RELATION_ARTICLES_PER_EVENT = 3;

export interface LinksDeps {
	digest: Pick<
		DigestRepository,
		'listRelationCandidates' | 'upsertRelation' | 'replaceLessonLinks'
	>;
	runTask: RunTask;
	now: () => Date;
	logger: Logger;
	counters: Required<
		Pick<
			JobCounters,
			'relations_published' | 'relations_pending_review' | 'relations_dropped' | 'lesson_links'
		>
	>;
}

/**
 * The event as stored after `saveEventContent` (so admin-kept title, category and tags are what
 * relations and lessons see), with the articles it was summarized from.
 */
export interface PublishedEvent {
	event: NewsEvent & { category: CategorySlug };
	articles: ArticleWithSource[];
}

export async function linkRelatedEvents(published: PublishedEvent, deps: LinksDeps): Promise<void> {
	const { event, articles } = published;
	const since = new Date(deps.now().getTime() - RELATION_LOOKBACK_MS).toISOString();
	const candidates = await deps.digest.listRelationCandidates(
		event.id,
		since,
		RELATION_CANDIDATE_LIMIT
	);
	if (candidates.length === 0) return;

	const refToArticleId: Record<string, string> = {};
	let nextRef = 1;
	const refArticles = (articles: ArticleWithSource[]) =>
		articles.slice(-RELATION_ARTICLES_PER_EVENT).map((article) => {
			const ref = `a${nextRef++}`;
			refToArticleId[ref] = article.id;
			return toArticleRef(article, ref);
		});

	const eventInput: EventRefInput = {
		ref: 'e1',
		title_th: event.title_th,
		summary_th: event.summary_th,
		event_date: event.event_date,
		category: event.category,
		tags: event.tags,
		articles: refArticles(articles)
	};
	const candidatesByRef = new Map<string, EventWithArticles>();
	const candidateInputs = candidates.map((candidate, index): EventRefInput => {
		const ref = `e${index + 2}`;
		candidatesByRef.set(ref, candidate);
		return {
			ref,
			title_th: candidate.event.title_th,
			summary_th: candidate.event.summary_th,
			event_date: candidate.event.event_date,
			// listRelationCandidates returns public events only, which always have a category.
			category: candidate.event.category!,
			tags: candidate.event.tags,
			articles: refArticles(candidate.articles)
		};
	});

	const result = await deps.runTask('relations', {
		event: eventInput,
		candidates: candidateInputs
	});
	if (!result.ok) return;

	const eventArticleIds = articles.map((article) => article.id);
	for (const relation of result.data.relations) {
		const candidate = candidatesByRef.get(relation.candidate_ref);
		const evidenceIds = mapRefsToArticleIds(relation.evidence, refToArticleId);
		if (!candidate || !evidenceIds) {
			deps.counters.relations_dropped++;
			continue;
		}
		const candidateArticleIds = candidate.articles.map((article) => article.id);
		const eventIsFrom = relation.direction === 'event_to_candidate';
		const decision = evaluateRelation({
			relation_type: relation.relation_type,
			explanation_th: relation.explanation_th,
			evidence_article_ids: evidenceIds,
			from_article_ids: eventIsFrom ? eventArticleIds : candidateArticleIds,
			to_article_ids: eventIsFrom ? candidateArticleIds : eventArticleIds,
			confidence: relation.confidence
		});
		if (decision.action === 'drop') {
			deps.counters.relations_dropped++;
			deps.logger.info('relation dropped', { event_id: event.id, reason: decision.reason });
			continue;
		}

		await deps.digest.upsertRelation({
			from_event_id: eventIsFrom ? event.id : candidate.event.id,
			to_event_id: eventIsFrom ? candidate.event.id : event.id,
			relation_type: relation.relation_type,
			explanation_th: relation.explanation_th,
			evidence_refs: evidenceIds.map((article_id) => ({ article_id })),
			status: decision.status,
			confidence: relation.confidence
		});
		if (decision.status === 'published') deps.counters.relations_published++;
		else deps.counters.relations_pending_review++;
	}
}

export async function linkAcademyLessons(
	event: PublishedEvent['event'],
	catalog: readonly AcademyLessonRow[],
	deps: LinksDeps
): Promise<void> {
	const lessons = prefilterLessons(event, catalog);
	if (lessons.length === 0) return;

	const result = await deps.runTask('academy_linking', {
		event: {
			ref: 'e1',
			title_th: event.title_th,
			summary_th: event.summary_th,
			category: event.category,
			tags: event.tags
		},
		lessons: lessons.map((lesson) => ({
			lesson_id: lesson.id,
			title: lesson.title,
			summary: lesson.summary,
			related_tags: lesson.tags,
			related_categories: lesson.categories
		}))
	});
	if (!result.ok) return;

	const existingIds = new Set(catalog.map((lesson) => lesson.id));
	const links = selectLessonLinks(result.data.links, existingIds);
	await deps.digest.replaceLessonLinks(
		event.id,
		links.map((link) => ({
			event_id: event.id,
			lesson_id: link.lesson_id,
			rationale_th: link.rationale_th,
			evidence_refs: []
		}))
	);
	deps.counters.lesson_links += links.length;
}

/**
 * Lessons sharing a tag (2 points each) or the category (1 point) with the event, best first
 * (earlier day on a tie). Lessons with neither are never offered.
 */
export function prefilterLessons(
	content: { category: CategorySlug; tags: readonly Tag[] },
	catalog: readonly AcademyLessonRow[]
): AcademyLessonRow[] {
	const eventTags = new Set(content.tags);
	return catalog
		.map((lesson) => ({
			lesson,
			score:
				2 * lesson.tags.filter((tag) => eventTags.has(tag)).length +
				(lesson.categories.includes(content.category) ? 1 : 0)
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.lesson.day - b.lesson.day)
		.slice(0, LESSON_CANDIDATE_LIMIT)
		.map((entry) => entry.lesson);
}
