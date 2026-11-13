import { describe, expect, it } from 'vitest';
import { createTokenBucketLimiter } from './rate-limit';

function limiterAt(clock: { ms: number }, maxKeys = 10) {
	return createTokenBucketLimiter({
		capacity: 3,
		refillPerSecond: 1,
		maxKeys,
		now: () => clock.ms
	});
}

describe('token bucket limiter', () => {
	it('allows the burst, then limits until tokens refill', () => {
		const clock = { ms: 0 };
		const limiter = limiterAt(clock);

		expect([1, 2, 3].map(() => limiter.take('ip').allowed)).toEqual([true, true, true]);
		expect(limiter.take('ip')).toEqual({ allowed: false, retryAfterSeconds: 1 });

		clock.ms += 1000;
		expect(limiter.take('ip').allowed).toBe(true);
		expect(limiter.take('ip').allowed).toBe(false);
	});

	it('never refills above the capacity', () => {
		const clock = { ms: 0 };
		const limiter = limiterAt(clock);
		limiter.take('ip');
		clock.ms += 60_000;
		expect([1, 2, 3, 4].map(() => limiter.take('ip').allowed)).toEqual([true, true, true, false]);
	});

	it('keeps at most maxKeys buckets (least recently used dropped first)', () => {
		const clock = { ms: 0 };
		const limiter = limiterAt(clock, 2);
		for (let i = 0; i < 3; i++) limiter.take('a');
		expect(limiter.take('a').allowed).toBe(false);

		limiter.take('b');
		limiter.take('c'); // evicts "a"
		expect(limiter.take('a').allowed).toBe(true);
	});
});
