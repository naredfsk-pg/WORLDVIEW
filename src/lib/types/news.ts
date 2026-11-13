/**
 * News acquisition contracts: source registry, adapters, normalization, dedup.
 * Implemented in `#lib/server/news`. Type-only imports.
 */
import type { Article, IsoUtc, Source, Tag } from './domain';

/** Checked-in registry entry (`src/lib/server/news/sources.ts`). Upserted into `sources` at ingest start. */
export type SourceDefinition = Omit<Source, 'last_success_at' | 'last_error_at' | 'last_error'>;

/** One item as parsed from RSS/Atom, before any normalization. All fields untrusted. */
export interface RawFeedItem {
	link: string | null;
	title: string | null;
	/** RSS description / Atom summary. May contain HTML; normalization strips it. */
	summary: string | null;
	/** Raw date string (RFC 822 or ISO 8601). */
	published: string | null;
	updated: string | null;
	guid: string | null;
	language: string | null;
	author: string | null;
	categories: string[];
}

/**
 * SSRF-safe fetch. Only reaches hosts in the registry allowlist, https only,
 * follows at most 3 redirects within the allowlist, timeout 15 s, max body 5 MB.
 * Rejects (throws `NewsFetchError`) otherwise.
 */
export type SafeFetch = (
	url: string,
	init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<Response>;

export interface FetchContext {
	safeFetch: SafeFetch;
	signal: AbortSignal;
	now: Date;
}

export interface FetchResult {
	items: RawFeedItem[];
	fetched_at: IsoUtc;
}

/** One adapter per `SourceKind`. Adapters fetch and parse only; they do not normalize or touch the DB. */
export interface NewsSourceAdapter {
	readonly kind: Source['kind'];
	fetch(source: SourceDefinition, ctx: FetchContext): Promise<FetchResult>;
}

export const NEWS_FETCH_ERROR_KINDS = [
	'not_allowed',
	'timeout',
	'http_error',
	'too_large',
	'parse_error',
	'network'
] as const;
export type NewsFetchErrorKind = (typeof NEWS_FETCH_ERROR_KINDS)[number];

/** Shape of the error thrown by adapters / SafeFetch. `retryable` drives backoff. */
export interface NewsFetchErrorInfo {
	kind: NewsFetchErrorKind;
	retryable: boolean;
	status: number | null;
	message: string;
}

/** Output of `normalizeFeedItem(source, raw, now)`; null result = item dropped (no link/title, bad URL). */
export type NormalizedArticle = Omit<Article, 'id' | 'taxonomy'>;

/** Dedup keys: an article is a duplicate if either key already exists. */
export interface DedupKeys {
	canonical_url: string;
	content_hash: string;
}

export type InsertArticleResult =
	| { outcome: 'inserted'; article_id: string }
	| { outcome: 'duplicate_url'; article_id: string }
	| { outcome: 'duplicate_content'; article_id: string };

/** What digest grouping compares a new article against. */
export interface EventMatchCandidate {
	event_id: string;
	/** title_th, or the earliest article title while still draft. */
	title: string;
	tags: Tag[];
	first_seen_at: IsoUtc;
	last_updated_at: IsoUtc;
	article_titles: string[];
}

/** Rule-based grouping verdict; `ambiguous` pairs go to the LLM `clustering` task. */
export type GroupingVerdict =
	| { kind: 'join'; event_id: string; confidence: number }
	| { kind: 'new_event' }
	| { kind: 'ambiguous'; event_id: string; score: number };

export interface ArticleWithSource extends Article {
	source_name: string;
	source_is_demo: boolean;
}
