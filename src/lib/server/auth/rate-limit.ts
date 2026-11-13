/**
 * In-memory token bucket per key (client IP), for admin form POSTs (ARCHITECTURE §4). One
 * process, no Redis: the limit resets on restart, which is fine for a single-editor admin area.
 */

export interface TokenBucketOptions {
	/** Burst size: requests allowed back to back. */
	capacity: number;
	refillPerSecond: number;
	/** Least recently used keys are dropped beyond this, so memory stays bounded. */
	maxKeys: number;
	now?: () => number;
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
	take(key: string): RateLimitResult;
}

/** Burst of 10 actions, then one every 2 s (30 per minute) per client IP. */
export const ADMIN_ACTION_RATE_LIMIT: TokenBucketOptions = {
	capacity: 10,
	refillPerSecond: 0.5,
	maxKeys: 1000
};

export function createTokenBucketLimiter(options: TokenBucketOptions): RateLimiter {
	const now = options.now ?? Date.now;
	const buckets = new Map<string, { tokens: number; updatedMs: number }>();

	return {
		take(key) {
			const nowMs = now();
			const bucket = buckets.get(key) ?? { tokens: options.capacity, updatedMs: nowMs };
			const refilled = ((nowMs - bucket.updatedMs) / 1000) * options.refillPerSecond;
			const tokens = Math.min(options.capacity, bucket.tokens + refilled);

			// Re-insert so Map order is least recently used first.
			buckets.delete(key);
			if (buckets.size >= options.maxKeys) {
				const oldest = buckets.keys().next().value;
				if (oldest !== undefined) buckets.delete(oldest);
			}

			if (tokens < 1) {
				buckets.set(key, { tokens, updatedMs: nowMs });
				const retryAfterSeconds = Math.ceil((1 - tokens) / options.refillPerSecond);
				return { allowed: false, retryAfterSeconds };
			}
			buckets.set(key, { tokens: tokens - 1, updatedMs: nowMs });
			return { allowed: true };
		}
	};
}
