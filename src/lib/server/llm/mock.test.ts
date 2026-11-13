import { describe, expect, it } from 'vitest';
import { LLM_TASKS } from '../../types/llm';
import { extractJsonObject } from './json';
import { createDefaultMockHandlers, createMockLlmProvider, mockLlmError } from './mock';
import { INPUT_BY_TASK, SUMMARY_INPUT, VALID_SUMMARY } from './test-fixtures';

describe('createMockLlmProvider', () => {
	it('default handlers give deterministic, schema-valid output for every task', async () => {
		const provider = createMockLlmProvider(createDefaultMockHandlers());

		for (const task of LLM_TASKS) {
			const input = INPUT_BY_TASK[task];
			const first = await provider.run(task, input);
			const second = await provider.run(task, input);

			expect(first, task).toMatchObject({ ok: true, meta: { task, model: 'mock' } });
			expect(second).toEqual(first);
		}
	});

	it('returns not_configured for a task without a handler', async () => {
		const result = await createMockLlmProvider({}).run('summary', SUMMARY_INPUT);
		expect(result).toMatchObject({ ok: false, error: { kind: 'not_configured' } });
	});

	it('returns the failure a handler simulates', async () => {
		const provider = createMockLlmProvider({ summary: () => mockLlmError('timeout') });
		expect(await provider.run('summary', SUMMARY_INPUT)).toMatchObject({
			ok: false,
			error: { kind: 'timeout' }
		});
	});

	it('validates handler output like real output (schema and refs)', async () => {
		const provider = createMockLlmProvider({
			summary: () => ({ ...VALID_SUMMARY, cited_refs: ['zz'] })
		});
		expect(await provider.run('summary', SUMMARY_INPUT)).toMatchObject({
			ok: false,
			error: { kind: 'invalid_output' }
		});
	});
});

describe('extractJsonObject', () => {
	it('strips fences and surrounding prose', () => {
		expect(extractJsonObject('Here you go:\n```json\n{"a":1}\n```')).toEqual({
			ok: true,
			value: { a: 1 }
		});
		expect(extractJsonObject('{"a":{"b":2}} trailing')).toEqual({
			ok: true,
			value: { a: { b: 2 } }
		});
	});

	it('reports missing or broken JSON', () => {
		expect(extractJsonObject('no json here')).toMatchObject({ ok: false });
		expect(extractJsonObject('{"a": }')).toMatchObject({ ok: false });
		expect(extractJsonObject('')).toMatchObject({ ok: false });
	});
});
