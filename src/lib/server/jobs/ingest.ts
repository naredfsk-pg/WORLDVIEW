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
	await forEachWithConcurrency(sources, deps.concurrency ?? SOURCE_CONCURRENCY, async (source) => {
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
			await deps.ingest.recordSourceFetch(source.id, {
				ok: false,
				at: ctx.now().toISOString(),
				error: message
			});
			ctx.logger.warn('source failed', { source_id: source.id, error: message });
		}
	});

	let groupingError: string | null = null;
	try {
		Object.assign(counters, await groupUnassignedArticles(deps.digest, ctx));
	} catch (error) {
		// Articles stay unassigned; the next ingest (or digest) groups them.
		groupingError = sanitizeError(error);
		ctx.logger.error('grouping failed', { error: groupingError });
	}

	const status =
		counters.sources_ok === 0
			? 'failed'
			: failures.length > 0 || groupingError
				? 'partial'
				: 'succeeded';
	const errors = [
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
	deps: Pick<IngestDeps, 'registry' | 'adapters' | 'safeFetch' | 'retry' | 'concurrency'>,
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
	deps: Pick<IngestDeps, 'adapters' | 'safeFetch' | 'retry'>,
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
	const articles = result.items.flatMap((item) => normalizeFeedItem(source, item, now) ?? []);
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
		if (result.outcome === 'inserted') inserted++;
		else if (result.outcome === 'duplicate_url') counters.duplicates_url++;
		else counters.duplicates_content++;
	}
	counters.articles_inserted += inserted;
	return inserted;
}

function describeSourceError(error: unknown): string {
	if (error instanceof NewsFetchError) return `${error.kind}: ${error.message}`.slice(0, 300);
	return sanitizeError(error);
}

async function forEachWithConcurrency<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) await worker(items[next++]!);
	});
	await Promise.all(lanes);
}
