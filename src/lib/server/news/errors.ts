/**
 * The one error type thrown by `SafeFetch`, the feed parser and the adapters (`NewsFetchErrorInfo`).
 * Messages are short and sanitized: they never include response bodies or feed content.
 */
import type { NewsFetchErrorInfo, NewsFetchErrorKind } from '#lib/types/news.js';

export class NewsFetchError extends Error implements NewsFetchErrorInfo {
	override name = 'NewsFetchError';
	readonly kind: NewsFetchErrorKind;
	readonly retryable: boolean;
	readonly status: number | null;
	/** Parsed `Retry-After`, honoured by the job's backoff (capped there). */
	readonly retry_after_ms: number | null;

	constructor(info: NewsFetchErrorInfo & { retry_after_ms?: number | null }) {
		super(info.message);
		this.kind = info.kind;
		this.retryable = info.retryable;
		this.status = info.status;
		this.retry_after_ms = info.retry_after_ms ?? null;
	}
}
