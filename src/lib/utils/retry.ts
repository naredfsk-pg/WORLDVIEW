/**
 * Exponential backoff with jitter (ARCHITECTURE §8). Pure apart from the default timer;
 * randomness and sleep are injectable.
 *
 * Delay after failed attempt n = min(max, base · 2^(n-1)) · rand(0.5..1);
 * a `Retry-After` hint replaces it, capped at `max`.
 */
import type { RetryPolicy } from '../types/jobs';

export interface RetryOptions {
	random?: () => number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/** Server hint (e.g. parsed `Retry-After`) for a failed attempt, or null. */
	retryAfterMs?: (error: unknown) => number | null;
	onRetry?: (info: { attempt: number; delay_ms: number; error: unknown }) => void;
	signal?: AbortSignal;
}

/** Runs `fn` until it succeeds, the error is not retryable, or `policy.max_attempts` is used up. */
export async function withRetry<T>(
	fn: (attempt: number) => Promise<T>,
	policy: RetryPolicy,
	isRetryable: (error: unknown) => boolean,
	options: RetryOptions = {}
): Promise<T> {
	const random = options.random ?? Math.random;
	const sleep = options.sleep ?? sleepFor;
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn(attempt);
		} catch (error) {
			const isLastAttempt = attempt >= policy.max_attempts;
			if (isLastAttempt || !isRetryable(error) || options.signal?.aborted) throw error;

			const delayMs = backoffDelayMs(
				attempt,
				policy,
				random(),
				options.retryAfterMs?.(error) ?? null
			);
			options.onRetry?.({ attempt, delay_ms: delayMs, error });
			await sleep(delayMs, options.signal);
		}
	}
}

/** `attempt` is the 1-based attempt that just failed; `random` is in [0, 1). */
export function backoffDelayMs(
	attempt: number,
	policy: RetryPolicy,
	random: number,
	retryAfterMs: number | null
): number {
	if (retryAfterMs !== null) return Math.min(policy.max_delay_ms, Math.max(0, retryAfterMs));
	const exponential = Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** (attempt - 1));
	return Math.round(exponential * (0.5 + 0.5 * random));
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
