/**
 * `ingest` job (ARCHITECTURE §8–9, PRD §4.3): sync the registry → fetch every enabled source
 * (bounded concurrency, backoff per source) → normalize → dedup-insert → group new articles into
 * draft events. A failing source never fails the run: it is recorded on the source row and the
 * run becomes `partial`. Every write is idempotent, so reruns never duplicate anything.
 */
import type { SourceKind } from '#lib/types/domain.js';
import type { JobContext, JobCounters, JobOutcome, Logger } from '#lib/types/jobs.js';
import type {
	NewsSourceAdapter,
	NormalizedArticle,
	SafeFetch,
	SourceDefinition
} from '#lib/types/news.js';
import type { DigestRepository, IngestRepository } from '#lib/types/repositories.js';
import { NewsFetchError } from '../news/errors.js';
import { normalizeFeedItem } from '../news/normalize.js';
import { groupUnassignedArticles } from './group-articles.js';
import { NEWS_FETCH_RETRY_POLICY, withRetry, type RetryOptions } from './retry.js';
import { sanitizeError } from './runner.js';

/** Sources fetched at the same time. */
export const SOURCE_CONCURRENCY = 3;
/**
 * Items published longer ago than this are dropped (counted in `items_dropped`), so a first
 * ingest does not turn a feed's whole back catalogue into past-dated draft events. Matches the
 * 72 h grouping window. Items without a timestamp are kept (their age is unknown).
 */
export const MAX_ITEM_AGE_HOURS = 72;

export interface IngestDeps {
	ingest: IngestRepository;
	digest: Pick<
		DigestRepository,
		'listUnassignedArticles' | 'listMatchableEvents' | 'createDraftEvent' | 'linkArticles'
	>;
	registry: readonly SourceDefinition[];
	/** A source whose kind has no adapter fails (e.g. `fixture` outside `--fixtures`). */
	adapters: Partial<Record<SourceKind, NewsSourceAdapter>>;
	safeFetch: SafeFetch;
	/** Tests inject `sleep`/`random` so backoff runs instantly and deterministically. */
	retry?: Pick<RetryOptions, 'sleep' | 'random'>;
	concurrency?: number;
	/** Defaults to `MAX_ITEM_AGE_HOURS`; null disables the check (the fixed-date fixture feeds). */
	maxItemAgeHours?: number | null;
}

export async function runIngest(deps: IngestDeps, ctx: JobContext): Promise<JobOutcome> {
	const counters = emptyIngestCounters();
	await deps.ingest.syncSources([...deps.registry]);
	const sources = await deps.ingest.listEnabledSources();
	if (sources.length === 0) {
		ctx.logger.warn('ingest has no enabled sources');
		return { status: 'failed', counters, error: 'no enabled sources' };
	}

	const failures: string[] = [];
	const notAttempted: string[] = [];
	await forEachWithConcurrency(sources, deps.concurrency ?? SOURCE_CONCURRENCY, async (source) => {
		// After the 20-minute abort, remaining sources are skipped, not blamed.
		if (ctx.signal.aborted) {
			notAttempted.push(source.id);
			return;
		}
		try {
			const fetched = await fetchAndNormalize(source, deps, ctx);
			counters.items_fetched += fetched.items_fetched;
			counters.items_dropped += fetched.items_dropped;
			const inserted = await insertArticles(deps.ingest, fetched.articles, counters);
			await deps.ingest.recordSourceFetch(source.id, { ok: true, at: ctx.now().toISOString() });
			counters.sources_ok++;
			ctx.logger.info('source ingested', {
				source_id: source.id,
				items_fetched: fetched.items_fetched,
				items_dropped: fetched.items_dropped,
				articles_inserted: inserted,
				fetch_duration_ms: fetched.duration_ms
			});
		} catch (error) {
			const message = describeSourceError(error);
			counters.sources_failed++;
			failures.push(`${source.id} (${message})`);
			if (ctx.signal.aborted) {
				// Cut off by the job timeout: not the source's fault, so its health row is left alone.
				ctx.logger.warn('source aborted', { source_id: source.id });
				return;
			}
			await deps.ingest.recordSourceFetch(source.id, {
				ok: false,
				at: ctx.now().toISOString(),
				error: message
			});
			ctx.logger.warn('source failed', { source_id: source.id, error: message });
		}
	});

	// Aborted: skip grouping; the next run groups whatever was inserted.
	let groupingError: string | null = null;
	if (ctx.signal.aborted) {
		ctx.logger.warn('ingest aborted; grouping skipped', { sources_not_attempted: notAttempted });
	} else {
		try {
			Object.assign(counters, await groupUnassignedArticles(deps.digest, ctx));
		} catch (error) {
			// Articles stay unassigned; the next ingest (or digest) groups them.
			groupingError = sanitizeError(error);
			ctx.logger.error('grouping failed', { error: groupingError });
		}
	}

	const isIncomplete = failures.length > 0 || notAttempted.length > 0 || groupingError !== null;
	const status = counters.sources_ok === 0 ? 'failed' : isIncomplete ? 'partial' : 'succeeded';
	const errors = [
		ctx.signal.aborted
			? `aborted by the job time limit; ${notAttempted.length} sources not attempted, grouping skipped`
			: null,
		failures.length > 0
			? `${failures.length} of ${sources.length} sources failed: ${failures.join(', ')}`
			: null,
		groupingError ? `grouping failed: ${groupingError}` : null
	].filter((part) => part !== null);
	return { status, counters, error: errors.length > 0 ? errors.join('; ').slice(0, 500) : null };
}

/**
 * `--dry-run`: fetch, parse and normalize the registry's enabled sources without touching the
 * database (no claim, no source sync, no inserts, no grouping).
 */
export async function previewIngest(
	deps: Pick<
		IngestDeps,
		'registry' | 'adapters' | 'safeFetch' | 'retry' | 'concurrency' | 'maxItemAgeHours'
	>,
	ctx: { now: () => Date; logger: Logger; signal: AbortSignal }
): Promise<JobOutcome> {
	const counters = { sources_ok: 0, sources_failed: 0, items_fetched: 0, items_dropped: 0 };
	const sources = deps.registry.filter((source) => source.enabled);
	await forEachWithConcurrency(sources, deps.concurrency ?? SOURCE_CONCURRENCY, async (source) => {
		try {
			const fetched = await fetchAndNormalize(source, deps, ctx);
			counters.sources_ok++;
			counters.items_fetched += fetched.items_fetched;
			counters.items_dropped += fetched.items_dropped;
			ctx.logger.info('dry-run source', {
				source_id: source.id,
				items_fetched: fetched.items_fetched,
				items_dropped: fetched.items_dropped,
				sample_titles: fetched.articles.slice(0, 3).map((article) => article.title),
				fetch_duration_ms: fetched.duration_ms
			});
		} catch (error) {
			counters.sources_failed++;
			ctx.logger.warn('dry-run source failed', {
				source_id: source.id,
				error: describeSourceError(error)
			});
		}
	});
	const status =
		sources.length === 0 || counters.sources_ok === 0
			? 'failed'
			: counters.sources_failed > 0
				? 'partial'
				: 'succeeded';
	return { status, counters, error: sources.length === 0 ? 'no enabled sources' : null };
}

function emptyIngestCounters() {
	return {
		sources_ok: 0,
		sources_failed: 0,
		items_fetched: 0,
		items_dropped: 0,
		articles_inserted: 0,
		duplicates_url: 0,
		duplicates_content: 0
	} satisfies JobCounters;
}

async function fetchAndNormalize(
	source: SourceDefinition,
	deps: Pick<IngestDeps, 'adapters' | 'safeFetch' | 'retry' | 'maxItemAgeHours'>,
	ctx: { now: () => Date; logger: Logger; signal: AbortSignal }
): Promise<{
	articles: NormalizedArticle[];
	items_fetched: number;
	items_dropped: number;
	duration_ms: number;
}> {
	const adapter = deps.adapters[source.kind];
	if (!adapter) {
		throw new NewsFetchError({
			kind: 'not_allowed',
			retryable: false,
			status: null,
			message: `no adapter for kind ${source.kind}`
		});
	}

	const startedMs = ctx.now().getTime();
	const result = await withRetry(
		() => adapter.fetch(source, { safeFetch: deps.safeFetch, signal: ctx.signal, now: ctx.now() }),
		NEWS_FETCH_RETRY_POLICY,
		(error) => error instanceof NewsFetchError && error.retryable,
		{
			...deps.retry,
			signal: ctx.signal,
			retryAfterMs: (error) => (error instanceof NewsFetchError ? error.retry_after_ms : null),
			onRetry: ({ attempt, delay_ms, error }) =>
				ctx.logger.warn('source fetch retry', {
					source_id: source.id,
					attempt,
					delay_ms,
					error: describeSourceError(error)
				})
		}
	);

	const now = ctx.now();
	const maxAgeHours =
		deps.maxItemAgeHours === undefined ? MAX_ITEM_AGE_HOURS : deps.maxItemAgeHours;
	const oldestAllowedMs =
		maxAgeHours === null ? -Infinity : now.getTime() - maxAgeHours * 60 * 60 * 1000;
	const articles = result.items.flatMap((item) => {
		const article = normalizeFeedItem(source, item, now);
		if (!article) return [];
		const isTooOld =
			article.published_at !== null && Date.parse(article.published_at) < oldestAllowedMs;
		return isTooOld ? [] : [article];
	});
	return {
		articles,
		items_fetched: result.items.length,
		items_dropped: result.items.length - articles.length,
		duration_ms: ctx.now().getTime() - startedMs
	};
}

/** Returns how many were inserted; duplicate outcomes go to their counters. */
async function insertArticles(
	ingest: IngestRepository,
	articles: NormalizedArticle[],
	counters: ReturnType<typeof emptyIngestCounters>
): Promise<number> {
	let inserted = 0;
	for (const article of articles) {
		const result = await ingest.insertArticleIfNew(article);
		// Counted per row, so a later failing insert does not hide the committed ones.
		if (result.outcome === 'inserted') {
			inserted++;
			counters.articles_inserted++;
		} else if (result.outcome === 'duplicate_url') counters.duplicates_url++;
		else counters.duplicates_content++;
	}
	return inserted;
}

function describeSourceError(error: unknown): string {
	if (error instanceof NewsFetchError) return `${error.kind}: ${error.message}`.slice(0, 300);
	return sanitizeError(error);
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. Waits for every lane to settle
 * before rethrowing the first error, so no lane is still writing after the caller gives up
 * (e.g. after the CLI closes the database).
 */
async function forEachWithConcurrency<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) await worker(items[next++]!);
	});
	const settled = await Promise.allSettled(lanes);
	const failure = settled.find((result) => result.status === 'rejected');
	if (failure) throw failure.reason;
}
