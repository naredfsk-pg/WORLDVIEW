/**
 * summary@2 (Wave 2 review): a live event's title stated one outlet's framing ("former CEO") as
 * fact. The prompt now requires title and summary to state only facts every source agrees on.
 * summary@3 (Wave 3): allegations about a named person stay attributed claims, and the optional
 * `update_th` timeline line. tagging@2: tags are topics, never allegations. Each version bump
 * invalidates the cached outputs of the previous one.
 */
import { describe, expect, it } from 'vitest';
import type { LlmCallRepository } from '../../../types/repositories';
import { createMockTransport } from '../mock';
import { createLlmProvider } from '../provider';
import { SUMMARY_INPUT, VALID_SUMMARY } from '../test-fixtures';
import { PROMPT_VERSIONS, TASK_DEFINITIONS } from './index';

const noCache: LlmCallRepository = {
	findCachedOutput: async () => null,
	record: async () => {},
	usageSince: async () => ({ requests: 0, tokens: 0 }),
	usageForJobRun: async () => ({ requests: 0, tokens: 0 })
};

describe('summary task prompt', () => {
	it('is version summary@3 (and tagging@2), so older cache entries are not reused', () => {
		expect(PROMPT_VERSIONS.summary).toBe('summary@3');
		expect(PROMPT_VERSIONS.tagging).toBe('tagging@2');
	});

	it('tells the models that allegations about a person are claims, and tags are topics', () => {
		const summary = TASK_DEFINITIONS.summary.systemPrompt;
		expect(summary).toContain('Allegations about a named person');
		expect(summary).toContain('are claims, never facts');
		expect(summary).toContain('update_th');
		const tagging = TASK_DEFINITIONS.tagging.systemPrompt;
		expect(tagging).toContain('Tags describe topics');
		expect(tagging).toContain('never allegations about individuals');
		expect(tagging).toContain('"alleged-spy"');
	});

	it('tells the model to attribute single-outlet or contested framing, never to state it in the title', async () => {
		const transport = createMockTransport([{ content: JSON.stringify(VALID_SUMMARY) }]);
		const provider = createLlmProvider({
			transport,
			calls: noCache,
			settings: {
				models: {
					tagging: undefined,
					clustering: undefined,
					extraction: undefined,
					summary: 'cc/model-a',
					relations: undefined,
					academyLinking: undefined,
					fallback: undefined,
					fallbackSecondary: undefined
				},
				omitTemperatureFor: [],
				maxConcurrency: 1,
				maxRetries: 0,
				maxInputTokens: 32000,
				maxOutputTokens: 4000,
				temperature: 0.1,
				dailyMaxRequests: 10,
				dailyMaxTokens: 100000
			},
			log: () => {}
		});

		const result = await provider.run('summary', SUMMARY_INPUT);

		expect(result.ok).toBe(true);
		const system = transport.requests[0]!.messages[0]!.content;
		expect(system).toContain('states only facts all supplied articles agree on');
		expect(system).toContain('ตามรายงานของ BBC');
		expect(system).toContain('leave it out of the title');
	});
});
