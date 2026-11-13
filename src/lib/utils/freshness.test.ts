import { describe, expect, it } from 'vitest';
import { computeFreshness } from './freshness';

const now = new Date('2026-11-13T06:00:00.000Z');

describe('computeFreshness', () => {
	it('is stale when no ingest has ever succeeded', () => {
		expect(
			computeFreshness({ last_ingest_succeeded_at: null, last_brief_published_at: null }, now)
		).toEqual({ last_ingest_succeeded_at: null, last_brief_published_at: null, stale: true });
	});

	it('is fresh just under 9 hours after the last ingest', () => {
		const result = computeFreshness(
			{ last_ingest_succeeded_at: '2026-11-12T21:00:00.001Z', last_brief_published_at: null },
			now
		);
		expect(result.stale).toBe(false);
	});

	it('is stale at exactly 9 hours', () => {
		const result = computeFreshness(
			{ last_ingest_succeeded_at: '2026-11-12T21:00:00.000Z', last_brief_published_at: null },
			now
		);
		expect(result.stale).toBe(true);
	});
});
