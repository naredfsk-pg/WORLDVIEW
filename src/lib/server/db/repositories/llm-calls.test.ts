import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LlmCall } from '../../../types/llm';
import type { Db } from '../client';
import { openTestDb } from '../test-db';
import { createLlmCallRepository } from './llm-calls';

let db: Db;
let calls: ReturnType<typeof createLlmCallRepository>;

beforeEach(() => {
	db = openTestDb();
	calls = createLlmCallRepository(db);
});
afterEach(() => db.$client.close());

const call = (overrides: Partial<Omit<LlmCall, 'id'>> = {}): Omit<LlmCall, 'id'> => ({
	created_at: '2026-11-13T00:00:00.000Z',
	task: 'summary',
	model: 'cc/test',
	prompt_version: 'summary@1',
	cache_key: 'key-1',
	status: 'ok',
	error_kind: null,
	tokens_in: 100,
	tokens_out: 50,
	latency_ms: 1200,
	output_json: '{"v":1}',
	job_run_id: null,
	...overrides
});

describe('LlmCallRepository', () => {
	it('returns the latest ok output for a cache key and ignores errors', async () => {
		await calls.record(call());
		await calls.record(call({ created_at: '2026-11-13T01:00:00.000Z', output_json: '{"v":2}' }));
		await calls.record(
			call({
				created_at: '2026-11-13T02:00:00.000Z',
				status: 'error',
				error_kind: 'timeout',
				output_json: null
			})
		);

		expect(await calls.findCachedOutput('key-1')).toBe('{"v":2}');
		expect(await calls.findCachedOutput('missing')).toBeNull();
	});

	it('sums requests and tokens since a cutoff, including errors', async () => {
		await calls.record(call({ created_at: '2026-11-12T16:59:59.999Z' }));
		await calls.record(call({ created_at: '2026-11-12T17:00:00.000Z' }));
		await calls.record(
			call({
				created_at: '2026-11-12T18:00:00.000Z',
				status: 'error',
				tokens_in: 10,
				tokens_out: 0
			})
		);

		expect(await calls.usageSince('2026-11-12T17:00:00.000Z')).toEqual({
			requests: 2,
			tokens: 160
		});
		expect(await calls.usageSince('2026-11-14T00:00:00.000Z')).toEqual({ requests: 0, tokens: 0 });
	});
});
