/**
 * `digest` job (ARCHITECTURE §8–9, AGENT_PLAN Wave 2 decision (a)). Ingest already grouped the
 * articles by rules; digest makes them publishable:
 * 1. group anything ingest left unassigned (rules only, no LLM)
 * 2. pick the events needing content and tag their articles `WHERE taxonomy IS NULL` (≤ 20 per call)
 * 3. ambiguous clustering: a draft event whose best rule score against another event was in the
 *    0.3–0.6 band goes to the LLM `clustering` task; `same_event` with enough confidence merges it
 * 4. per event: extraction → summary → publish gates → save (see digest-content.ts)
 * 5. per event published in this run: relations and Academy links (see digest-links.ts)
 * LLM failures never throw: each ends in a gate decision, and the run becomes `partial`.
 */
import type { AcademyLessonRow } from '#lib/types/domain.js';
import type { JobContext, JobCounters, JobOutcome } from '#lib/types/jobs.js';
import type { ClusteringInput, LLMProvider, LlmErrorKind } from '#lib/types/llm.js';
import type { ArticleWithSource, EventMatchCandidate } from '#lib/types/news.js';
import type {
	DigestRepository,
	EventWithArticles,
	LlmCallRepository
} from '#lib/types/repositories.js';
import { bestEventMatch, GROUPING_CONFIG } from '../news/grouping.js';
import { generateEventContent } from './digest-content.js';
import { createRunTask, toArticleRef, type RunTask } from './digest-llm.js';
import { linkAcademyLessons, linkRelatedEvents, type PublishedEvent } from './digest-links.js';
import { GROUPING_LOOKBACK_MS, groupUnassignedArticles } from './group-articles.js';
import { sanitizeError } from './runner.js';

/** ARCHITECTURE §9: content for up to 30 events per run. */
export const MAX_CONTENT_EVENTS = 30;
export const TAGGING_BATCH_SIZE = 20;
/** Pairs per `clustering` call. */
export const MAX_CLUSTERING_PAIRS = 20;
/** A wrong merge is worse than a duplicate: merge only on a confident `same_event`. */
export const CLUSTERING_MERGE_MIN_CONFIDENCE = 0.7;

export interface DigestDeps {
	digest: DigestRepository;
	llm: LLMProvider;
	/** Network requests and tokens of this run are read back from `llm_calls`. */
	llmCalls: Pick<LlmCallRepository, 'usageForJobRun'>;
	/** `--max-events N`: bounds how many events get content (and so how many LLM calls run). */
	maxEvents?: number;
}

export async function runDigest(deps: DigestDeps, ctx: JobContext): Promise<JobOutcome> {
	const counters = emptyDigestCounters();
	const runTask = createRunTask(deps.llm, ctx, counters);
	const errors: string[] = [];
	const limit = Math.max(1, Math.min(deps.maxEvents ?? MAX_CONTENT_EVENTS, MAX_CONTENT_EVENTS));

	const grouped = await groupUnassignedArticles(deps.digest, ctx);
	counters.articles_grouped = grouped.articles_grouped;
	counters.events_created = grouped.events_created;
	counters.events_updated = grouped.events_updated;

	const tagging = { errorKind: null as LlmErrorKind | null };
	let events = await prepareEvents(deps.digest, runTask, limit, tagging);
	const merged = await mergeAmbiguousDrafts(deps.digest, runTask, events, ctx);
	if (merged > 0) {
		counters.events_updated += merged;
		events = await prepareEvents(deps.digest, runTask, limit, tagging);
	}

	const published: PublishedEvent[] = [];
	for (const item of events) {
		if (ctx.signal.aborted) break;
		try {
			const result = await generateEventContent(item, {
				digest: deps.digest,
				runTask,
				now: ctx.now,
				logger: ctx.logger,
				taggingErrorKind: tagging.errorKind
			});
			if (result.outcome === 'published') {
				counters.events_published++;
				published.push({
					id: item.event.id,
					event_date: item.event.event_date,
					content: result.content,
					articles: item.articles
				});
			} else if (result.outcome === 'pending_review') {
				counters.events_pending_review++;
			}
		} catch (error) {
			errors.push(`event ${item.event.id}: ${sanitizeError(error)}`);
		}
	}

	let catalog: AcademyLessonRow[] | null = null;
	const linksDeps = { digest: deps.digest, runTask, now: ctx.now, logger: ctx.logger, counters };
	for (const event of published) {
		if (ctx.signal.aborted) break;
		try {
			await linkRelatedEvents(event, linksDeps);
			catalog ??= await deps.digest.listLessonCatalog();
			await linkAcademyLessons(event, catalog, linksDeps);
		} catch (error) {
			errors.push(`links ${event.id}: ${sanitizeError(error)}`);
		}
	}

	const usage = await deps.llmCalls.usageForJobRun(ctx.run.id);
	counters.llm_requests = usage.requests;
	counters.llm_tokens = usage.tokens;
	if (ctx.signal.aborted) errors.unshift('aborted by the job time limit');
	errors.forEach((error) => ctx.logger.error('digest step failed', { error }));

	const isIncomplete = errors.length > 0 || counters.llm_failures > 0;
	return {
		status: isIncomplete ? 'partial' : 'succeeded',
		counters,
		error: errors.length > 0 ? errors.join('; ').slice(0, 500) : null
	};
}

function emptyDigestCounters() {
	return {
		articles_grouped: 0,
		events_created: 0,
		events_updated: 0,
		events_published: 0,
		events_pending_review: 0,
		relations_published: 0,
		relations_pending_review: 0,
		relations_dropped: 0,
		lesson_links: 0,
		llm_requests: 0,
		llm_cache_hits: 0,
		llm_failures: 0,
		llm_tokens: 0
	} satisfies JobCounters;
}

/**
 * The events needing content, with their untagged articles tagged first. Lists again after
 * tagging so the events carry the stored taxonomy. Records the last tagging failure in `tagging`.
 */
async function prepareEvents(
	digest: DigestRepository,
	runTask: RunTask,
	limit: number,
	tagging: { errorKind: LlmErrorKind | null }
): Promise<EventWithArticles[]> {
	const listed = await digest.listEventsNeedingContent(limit);
	const untagged = listed.flatMap((item) => item.articles).filter((a) => a.taxonomy === null);
	if (untagged.length === 0) return listed;

	let saved = 0;
	for (let start = 0; start < untagged.length; start += TAGGING_BATCH_SIZE) {
		const batch = untagged.slice(start, start + TAGGING_BATCH_SIZE);
		const result = await runTask('tagging', {
			articles: batch.map((article, index) => toArticleRef(article, `a${index + 1}`))
		});
		if (!result.ok) {
			tagging.errorKind = result.error.kind;
			continue;
		}
		// Articles the model left out stay untagged and are retried by the next run.
		for (const item of result.data.items) {
			const article = batch[Number(item.ref.slice(1)) - 1];
			if (!article) continue;
			const { category, regions, countries, tags } = item;
			await digest.saveArticleTaxonomy(article.id, { category, regions, countries, tags });
			saved++;
		}
	}
	return saved > 0 ? digest.listEventsNeedingContent(limit) : listed;
}

/**
 * Ingest turns an ambiguous match (rule score 0.3–0.6) into a new draft event. Here the LLM
 * decides: a confident `same_event` merges the draft into the other event; anything else, or a
 * failed call, keeps them separate. Returns how many drafts were merged.
 */
async function mergeAmbiguousDrafts(
	digest: DigestRepository,
	runTask: RunTask,
	events: EventWithArticles[],
	ctx: JobContext
): Promise<number> {
	const drafts = events.filter((item) => item.event.status === 'draft');
	if (drafts.length === 0) return 0;

	const since = new Date(ctx.now().getTime() - GROUPING_LOOKBACK_MS).toISOString();
	const candidates = await digest.listMatchableEvents(since);
	const pairs = findAmbiguousPairs(drafts, candidates).slice(0, MAX_CLUSTERING_PAIRS);
	if (pairs.length === 0) return 0;

	const input: ClusteringInput = {
		pairs: pairs.map((pair, index) => ({
			pair_ref: `p${index + 1}`,
			a: clusterItemOfDraft(pair.draft.articles),
			b: {
				title: pair.other.title,
				summary: pair.other.article_titles.slice(0, 3).join(' / ') || null,
				published_at: pair.other.first_seen_at,
				tags: pair.other.tags
			}
		}))
	};
	const result = await runTask('clustering', input);
	if (!result.ok) return 0;

	const removed = new Set<string>();
	let merged = 0;
	for (const decision of result.data.decisions) {
		const pair = pairs[Number(decision.pair_ref.slice(1)) - 1];
		const isSameEvent =
			decision.verdict === 'same_event' && decision.confidence >= CLUSTERING_MERGE_MIN_CONFIDENCE;
		if (!pair || !isSameEvent) continue;

		// The draft is always the one merged away; derived fields are recomputed on the target.
		const source = pair.draft.event.id;
		const target = pair.other.event_id;
		if (removed.has(source) || removed.has(target)) continue;
		await digest.mergeDraftEvent(source, target, decision.confidence, ctx.now().toISOString());
		removed.add(source);
		merged++;
		ctx.logger.info('ambiguous draft merged', { source_event_id: source, target_event_id: target });
	}
	return merged;
}

interface AmbiguousPair {
	draft: EventWithArticles;
	other: EventMatchCandidate;
}

/** One pair per unordered event pair; demo and real events are never paired. */
function findAmbiguousPairs(
	drafts: EventWithArticles[],
	candidates: EventMatchCandidate[]
): AmbiguousPair[] {
	const seen = new Set<string>();
	const pairs: AmbiguousPair[] = [];
	for (const draft of drafts) {
		const others = candidates.filter(
			(candidate) =>
				candidate.event_id !== draft.event.id && candidate.is_demo === draft.event.is_demo
		);
		const match = bestEventMatch(draft.articles, others);
		const isAmbiguous =
			match !== null &&
			match.score >= GROUPING_CONFIG.ambiguousThreshold &&
			match.score < GROUPING_CONFIG.joinThreshold;
		if (!isAmbiguous) continue;

		const key = [draft.event.id, match.event_id].sort().join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		pairs.push({ draft, other: others.find((other) => other.event_id === match.event_id)! });
	}
	return pairs;
}

function clusterItemOfDraft(articles: ArticleWithSource[]): ClusteringInput['pairs'][number]['a'] {
	const first = articles[0]!;
	const tags = [...new Set(articles.flatMap((article) => article.taxonomy?.tags ?? []))];
	return {
		title: first.title,
		summary:
			articles
				.slice(1, 4)
				.map((article) => article.title)
				.join(' / ') || null,
		published_at: first.published_at ?? first.ingested_at,
		tags
	};
}
