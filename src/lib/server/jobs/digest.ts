/**
 * `digest` job (ARCHITECTURE §8–9, AGENT_PLAN Wave 2 decision (a)). Ingest already grouped the
 * articles by rules; digest makes them publishable:
 * 1. group anything ingest left unassigned (rules only, no LLM)
 * 2. pick the events needing content and tag their articles `WHERE taxonomy IS NULL` (≤ 20 per call)
 * 3. ambiguous clustering: a draft event whose best rule score against another event was in the
 *    0.3–0.6 band, or a single-article draft sharing ≥ 2 tags with a published event, goes to the
 *    LLM `clustering` task; `same_event` merges it into a draft or pending target, or sends it
 *    to review as a possible duplicate of a published target (published events never change)
 * 4. per event: extraction → summary → publish gates → save (see digest-content.ts)
 * 5. per event published in this run: relations and Academy links (see digest-links.ts)
 * LLM failures never throw: each ends in a gate decision, and the run becomes `partial`.
 * A failing step or unit (grouping, a tagging batch, a merge pair, an event, its links) is
 * skipped, recorded in the run error and makes the run `partial`, never `failed`: an admin
 * hide or another job writing at the same time must not stop the rest of the run.
 */
import type { AcademyLessonRow, IsoUtc } from '#lib/types/domain.js';
import type { AutoPublishPolicy } from '#lib/types/editorial.js';
import type { JobContext, JobCounters, JobOutcome } from '#lib/types/jobs.js';
import type { ClusteringInput, LLMProvider, LlmErrorKind } from '#lib/types/llm.js';
import type { ArticleWithSource, EventMatchCandidate } from '#lib/types/news.js';
import type {
	DigestRepository,
	EventWithArticles,
	LlmCallRepository
} from '#lib/types/repositories.js';
import { containsLinkOrContact, isThaiText } from '../editorial/index.js';
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
/**
 * A wrong merge is worse than a duplicate: merge a draft into a draft or pending event only on a
 * confident `same_event`. Raised from 0.7 in Wave 3 after a borderline merge of two different
 * happenings of one papal visit. (A published target is never merged into: see below.)
 */
export const CLUSTERING_MERGE_MIN_CONFIDENCE = 0.8;
/**
 * Recall for published events: a single-article draft whose article shares at least this many
 * tags with a published event is sent to the LLM even when the titles share almost no words
 * ("Nvidia scandal sparks …" vs "Ex-Nvidia CEO … summoned to testify" scores 0.05). A
 * `same_event` answer only flags the draft for review (`possible_duplicate`).
 */
export const PUBLISHED_TARGET_MIN_SHARED_TAGS = 2;
/**
 * Retry backoff for transient LLM failures (`pending_review [llm_failed]`): an event is retried
 * only when its row was last written at least this long ago. With the four digest runs a day
 * (06, 12, 18, 23 ICT) that is about two retries a day instead of one per run.
 */
export const LLM_FAILED_RETRY_DELAY_MS = 11 * 60 * 60 * 1000;

export interface DigestDeps {
	digest: DigestRepository;
	llm: LLMProvider;
	/** Network requests and tokens of this run are read back from `llm_calls`. */
	llmCalls: Pick<LlmCallRepository, 'usageForJobRun'>;
	/** `--max-events N`: bounds how many events get content (and so how many LLM calls run). */
	maxEvents?: number;
	/** `EDITORIAL_AUTO_PUBLISH` (ARCHITECTURE §11). */
	autoPublish: AutoPublishPolicy;
	/** `RELATIONS_AUTO_PUBLISH_MIN_CONFIDENCE`: used only with policy `all` (ARCHITECTURE §11). */
	relationMinConfidence: number;
}

export async function runDigest(deps: DigestDeps, ctx: JobContext): Promise<JobOutcome> {
	const counters = emptyDigestCounters();
	const runTask = createRunTask(deps.llm, ctx, counters);
	const errors: string[] = [];
	const limit = Math.max(1, Math.min(deps.maxEvents ?? MAX_CONTENT_EVENTS, MAX_CONTENT_EVENTS));

	try {
		const grouped = await groupUnassignedArticles(deps.digest, ctx);
		counters.articles_grouped = grouped.articles_grouped;
		counters.events_created = grouped.events_created;
		counters.events_updated = grouped.events_updated;
	} catch (error) {
		// Articles stay unassigned; ingest or the next digest groups them.
		errors.push(`grouping: ${sanitizeError(error)}`);
	}

	const taggingFailures = new Map<string, LlmErrorKind>();
	let prepared = await prepareEvents(deps.digest, runTask, limit, taggingFailures, ctx, errors);
	const clustered = await clusterAmbiguousDrafts(
		deps.digest,
		runTask,
		prepared.events,
		ctx,
		errors
	);
	counters.events_updated += clustered.merged;
	counters.relations_pending_review += clustered.flagged;
	if (clustered.merged + clustered.flagged > 0) {
		// Merge targets and flagged drafts changed: the content step needs the rows as stored.
		prepared = await prepareEvents(deps.digest, runTask, limit, taggingFailures, ctx, errors);
	}

	const published: PublishedEvent[] = [];
	for (const item of prepared.events) {
		if (ctx.signal.aborted) break;
		try {
			const result = await generateEventContent(item, {
				digest: deps.digest,
				runTask,
				now: ctx.now,
				logger: ctx.logger,
				checkedAt: prepared.listedAt,
				taggingErrorKind: taggingErrorFor(item, taggingFailures),
				autoPublish: deps.autoPublish
			});
			if (result.outcome === 'deferred') {
				// No LLM call can succeed in this run any more; the rest waits, unchanged.
				errors.push('LLM budget used up; remaining events wait for the next run');
				break;
			}
			if (result.outcome === 'published' && result.event.category !== null) {
				counters.events_published++;
				published.push({
					event: { ...result.event, category: result.event.category },
					articles: item.articles
				});
			} else if (result.outcome === 'pending_review') {
				counters.events_pending_review++;
			} else if (result.outcome === 'new_evidence_pending') {
				counters.events_new_evidence++;
			} else if (result.outcome === 'skipped') {
				counters.events_skipped++;
			}
		} catch (error) {
			errors.push(`event ${item.event.id}: ${sanitizeError(error)}`);
		}
	}

	let catalog: AcademyLessonRow[] | null = null;
	const linksDeps = {
		digest: deps.digest,
		runTask,
		now: ctx.now,
		logger: ctx.logger,
		autoPublish: deps.autoPublish,
		relationMinConfidence: deps.relationMinConfidence,
		counters
	};
	for (const event of published) {
		if (ctx.signal.aborted) break;
		try {
			await linkRelatedEvents(event, linksDeps);
			catalog ??= await deps.digest.listLessonCatalog();
			await linkAcademyLessons(event.event, catalog, linksDeps);
		} catch (error) {
			errors.push(`links ${event.event.id}: ${sanitizeError(error)}`);
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
		events_new_evidence: 0,
		events_skipped: 0,
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
 * The events needing content, with their untagged articles tagged first, and the time they were
 * listed (the evidence the LLM sees is what was linked by then). Lists again after tagging so the
 * events carry the stored taxonomy. A failed tagging batch records its error kind per article.
 */
async function prepareEvents(
	digest: DigestRepository,
	runTask: RunTask,
	limit: number,
	taggingFailures: Map<string, LlmErrorKind>,
	ctx: JobContext,
	errors: string[]
): Promise<{ events: EventWithArticles[]; listedAt: IsoUtc }> {
	const listedAt = ctx.now().toISOString();
	const retryFailedBefore = new Date(ctx.now().getTime() - LLM_FAILED_RETRY_DELAY_MS).toISOString();
	const listed = await digest.listEventsNeedingContent(limit, retryFailedBefore);
	const untagged = listed.flatMap((item) => item.articles).filter((a) => a.taxonomy === null);
	if (untagged.length === 0) return { events: listed, listedAt };

	let saved = 0;
	for (let start = 0; start < untagged.length; start += TAGGING_BATCH_SIZE) {
		if (ctx.signal.aborted) break;
		const batch = untagged.slice(start, start + TAGGING_BATCH_SIZE);
		const result = await runTask('tagging', {
			articles: batch.map((article, index) => toArticleRef(article, `a${index + 1}`))
		});
		if (!result.ok) {
			batch.forEach((article) => taggingFailures.set(article.id, result.error.kind));
			continue;
		}
		try {
			// Articles the model left out stay untagged and are retried by the next run.
			for (const item of result.data.items) {
				const article = batch[Number(item.ref.slice(1)) - 1];
				if (!article) continue;
				const { category, regions, countries, tags } = item;
				await digest.saveArticleTaxonomy(article.id, { category, regions, countries, tags });
				saved++;
			}
		} catch (error) {
			errors.push(`tagging batch ${start / TAGGING_BATCH_SIZE + 1}: ${sanitizeError(error)}`);
		}
	}
	if (saved === 0) return { events: listed, listedAt };
	return { events: await digest.listEventsNeedingContent(limit, retryFailedBefore), listedAt };
}

/**
 * The error to report for an event whose articles are all untagged. Only a request that can
 * never succeed (`invalid_request`, `input_too_large`) is passed on, so a human looks at it, and
 * `budget_exceeded`, so the event is deferred untouched; anything else, including untagged
 * articles with no error, becomes `llm_failed` and is retried.
 */
function taggingErrorFor(
	item: EventWithArticles,
	taggingFailures: Map<string, LlmErrorKind>
): LlmErrorKind | null {
	for (const article of item.articles) {
		const kind = taggingFailures.get(article.id);
		if (kind === 'invalid_request' || kind === 'input_too_large' || kind === 'budget_exceeded') {
			return kind;
		}
	}
	return null;
}

/**
 * Ingest turns an ambiguous match (rule score 0.3–0.6) into a new draft event. Here the LLM
 * decides, and a published event is never changed by it:
 * - `same_event` with a draft or pending target, at enough confidence → the draft is merged into
 *   it (`mergeDraftEvent`)
 * - `same_event` with a published target, at any confidence → the draft stays its own event but
 *   gets `possible_duplicate` (so it is never auto-published) and a pending `same_topic` relation
 *   to the published event, for an admin to decide in `/admin/relations` and `/admin/review`
 * - anything else, or a failed call → nothing
 * Every event a merge touched (source and target) is left out of later decisions of this run,
 * so a chain of merges never acts on articles the LLM did not compare.
 */
async function clusterAmbiguousDrafts(
	digest: DigestRepository,
	runTask: RunTask,
	events: EventWithArticles[],
	ctx: JobContext,
	errors: string[]
): Promise<{ merged: number; flagged: number }> {
	const none = { merged: 0, flagged: 0 };
	const drafts = events.filter((item) => item.event.status === 'draft');
	if (drafts.length === 0) return none;

	const since = new Date(ctx.now().getTime() - GROUPING_LOOKBACK_MS).toISOString();
	let candidates: EventMatchCandidate[];
	try {
		candidates = await digest.listMatchableEvents(since);
	} catch (error) {
		errors.push(`clustering: ${sanitizeError(error)}`);
		return none;
	}
	const pairs = findAmbiguousPairs(drafts, candidates);
	if (pairs.length === 0) return none;

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
	if (!result.ok) return none;

	const touched = new Set<string>();
	const outcome = { merged: 0, flagged: 0 };
	for (const decision of result.data.decisions) {
		const pair = pairs[Number(decision.pair_ref.slice(1)) - 1];
		if (!pair || decision.verdict !== 'same_event') continue;

		// The draft is always the one merged away or flagged; derived fields are recomputed.
		const source = pair.draft.event.id;
		const target = pair.other.event_id;
		if (touched.has(source) || touched.has(target)) continue;
		const ids = { source_event_id: source, target_event_id: target };
		try {
			// One pair failing (the target was hidden meanwhile, another job linked or deleted an
			// event) never stops the other pairs or the run.
			if (pair.other.status === 'published') {
				const done = await digest.flagPossibleDuplicate(
					source,
					target,
					{
						explanation_th: duplicateExplanation(decision.rationale_th, decision.confidence),
						evidence_article_ids: pair.draft.articles.map((article) => article.id),
						confidence: decision.confidence
					},
					ctx.now().toISOString()
				);
				if (!done) continue;
				touched.add(source);
				outcome.flagged++;
				ctx.logger.info('possible duplicate of a published event sent to review', ids);
				continue;
			}

			if (decision.confidence < CLUSTERING_MERGE_MIN_CONFIDENCE) continue;
			const done = await digest.mergeDraftEvent(
				source,
				target,
				decision.confidence,
				ctx.now().toISOString()
			);
			if (!done) {
				ctx.logger.info('merge skipped: the draft has admin edits', ids);
				continue;
			}
			touched.add(source);
			touched.add(target);
			outcome.merged++;
			ctx.logger.info('ambiguous draft merged', ids);
		} catch (error) {
			errors.push(`merge ${source}: ${sanitizeError(error)}`);
		}
	}
	return outcome;
}

/** The relation text an admin sees: the model's Thai rationale when usable, else a fixed line. */
function duplicateExplanation(rationale: string | null | undefined, confidence: number): string {
	const text = rationale?.trim() ?? '';
	if (isThaiText(text) && !containsLinkOrContact(text)) return text;
	return `ระบบจัดกลุ่มข่าวเห็นว่าอาจเป็นเหตุการณ์เดียวกับข่าวที่เผยแพร่แล้ว (ความมั่นใจ ${Math.round(confidence * 100)}%)`;
}

interface AmbiguousPair {
	draft: EventWithArticles;
	other: EventMatchCandidate;
}

/**
 * At most `MAX_CLUSTERING_PAIRS` pairs, one per draft and per unordered event pair; demo and real
 * events are never paired, and hidden events are never candidates. Rule-band pairs come first;
 * the remaining slots go to single-article drafts paired with a published event by shared tags,
 * so tag pairs never crowd out a rule-band pair.
 */
function findAmbiguousPairs(
	drafts: EventWithArticles[],
	candidates: EventMatchCandidate[]
): AmbiguousPair[] {
	const othersOf = (draft: EventWithArticles) =>
		candidates.filter(
			(candidate) =>
				candidate.event_id !== draft.event.id && candidate.is_demo === draft.event.is_demo
		);
	const seen = new Set<string>();
	const paired = new Set<string>();
	const pairs: AmbiguousPair[] = [];
	const addPair = (draft: EventWithArticles, other: EventMatchCandidate | null) => {
		if (!other || paired.has(draft.event.id)) return;
		const key = [draft.event.id, other.event_id].sort().join('|');
		if (seen.has(key)) return;
		seen.add(key);
		paired.add(draft.event.id);
		pairs.push({ draft, other });
	};

	for (const draft of drafts) addPair(draft, ambiguousRuleMatch(draft, othersOf(draft)));
	for (const draft of drafts) addPair(draft, publishedTagMatch(draft, othersOf(draft)));
	return pairs.slice(0, MAX_CLUSTERING_PAIRS);
}

/** The best rule match, when its score is in the ambiguous band (0.3–0.6). */
function ambiguousRuleMatch(
	draft: EventWithArticles,
	others: EventMatchCandidate[]
): EventMatchCandidate | null {
	const match = bestEventMatch(draft.articles, others);
	const isAmbiguous =
		match !== null &&
		match.score >= GROUPING_CONFIG.ambiguousThreshold &&
		match.score < GROUPING_CONFIG.joinThreshold;
	if (!isAmbiguous) return null;
	return others.find((other) => other.event_id === match.event_id) ?? null;
}

/**
 * For a draft of one tagged article: the published event sharing the most tags with it, if at
 * least `PUBLISHED_TARGET_MIN_SHARED_TAGS` (ties go to the newest, the candidates' order).
 */
function publishedTagMatch(
	draft: EventWithArticles,
	others: EventMatchCandidate[]
): EventMatchCandidate | null {
	if (draft.articles.length !== 1) return null;
	const draftTags = new Set(draft.articles[0]!.taxonomy?.tags ?? []);
	let best: EventMatchCandidate | null = null;
	let bestShared = PUBLISHED_TARGET_MIN_SHARED_TAGS - 1;
	for (const other of others) {
		if (other.status !== 'published') continue;
		const shared = other.tags.filter((tag) => draftTags.has(tag)).length;
		if (shared > bestShared) {
			best = other;
			bestShared = shared;
		}
	}
	return best;
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
