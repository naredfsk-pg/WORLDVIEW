import { describe, expect, it } from 'vitest';
import type { RetryPolicy } from '../types/jobs';
import { backoffDelayMs, withRetry } from './retry';

const policy: RetryPolicy = { max_attempts: 3, base_delay_ms: 1_000, max_delay_ms: 10_000 };

describe('backoffDelayMs', () => {
	it('doubles from the base and applies jitter in [0.5, 1)', () => {
		expect(backoffDelayMs(1, policy, 0, null)).toBe(500);
		expect(backoffDelayMs(1, policy, 0.999, null)).toBe(1000);
		expect(backoffDelayMs(2, policy, 0, null)).toBe(1000);
		expect(backoffDelayMs(3, policy, 0.999, null)).toBe(3998);
	});

	it('caps at max_delay_ms however many attempts', () => {
		for (const attempt of [5, 10, 50]) {
			expect(backoffDelayMs(attempt, policy, 0.999, null)).toBeLessThanOrEqual(policy.max_delay_ms);
		}
		expect(backoffDelayMs(50, policy, 0.999, null)).toBe(9_995);
	});

	it('honours Retry-After, capped at max_delay_ms', () => {
		expect(backoffDelayMs(1, policy, 0.5, 3_000)).toBe(3_000);
		expect(backoffDelayMs(1, policy, 0.5, 120_000)).toBe(policy.max_delay_ms);
	});
});

describe('withRetry', () => {
	const instant = { sleep: async () => {}, random: () => 0 };

	it('retries retryable errors up to max_attempts, then rethrows the last one', async () => {
		const delays: number[] = [];
		let calls = 0;
		const pending = withRetry(
			async () => {
				calls++;
				throw new Error(`fail ${calls}`);
			},
			policy,
			() => true,
			{ ...instant, onRetry: ({ delay_ms }) => delays.push(delay_ms) }
		);
		await expect(pending).rejects.toThrow('fail 3');
		expect(calls).toBe(policy.max_attempts);
		expect(delays).toEqual([500, 1000]);
	});

	it('does not retry a non-retryable error', async () => {
		let calls = 0;
		const pending = withRetry(
			async () => {
				calls++;
				throw new Error('bad request');
			},
			policy,
			() => false,
			instant
		);
		await expect(pending).rejects.toThrow('bad request');
		expect(calls).toBe(1);
	});

	it('returns the first success', async () => {
		let calls = 0;
		const value = await withRetry(
			async (attempt) => {
				calls++;
				if (attempt < 2) throw new Error('flaky');
				return 'ok';
			},
			policy,
			() => true,
			instant
		);
		expect(value).toBe('ok');
		expect(calls).toBe(2);
	});

	it('stops retrying once the signal is aborted', async () => {
		const controller = new AbortController();
		let calls = 0;
		const pending = withRetry(
			async () => {
				calls++;
				controller.abort();
				throw new Error('aborted run');
			},
			policy,
			() => true,
			{ ...instant, signal: controller.signal }
		);
		await expect(pending).rejects.toThrow('aborted run');
		expect(calls).toBe(1);
	});
});
