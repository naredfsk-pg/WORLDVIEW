/**
 * summary@2 (Wave 2 review): a live event's title stated one outlet's framing ("former CEO") as
 * fact. The prompt now requires title and summary to state only facts every source agrees on.
 * summary@3 (Wave 3): allegations about a named person stay attributed claims, and the optional
 * `update_th` timeline line. summary@4 (review): `update_refs`, and both timeline fields are
 * lenient. tagging@2: tags are topics, never allegations. Each version bump
 * invalidates the cached outputs of the previous one.
 */
import { describe, expect, it } from 'vitest';
import type { LlmCallRepository } from '../../../types/repositories';
import { createMockTransport } from '../mock';
import { createLlmProvider } from '../provider';
import { SUMMARY_INPUT, VALID_SUMMARY } from '../test-fixtures';
import { PROMPT_VERSIONS, TASK_DEFINITIONS } from './index';
import { validateOutput } from './shared';

const noCache: LlmCallRepository = {
	findCachedOutput: async () => null,
	record: async () => {},
	usageSince: async () => ({ requests: 0, tokens: 0 }),
	usageForJobRun: async () => ({ requests: 0, tokens: 0 })
};

describe('summary task prompt', () => {
	it('is version summary@4 (tagging@2, clustering@3), so older cache entries are not reused', () => {
		expect(PROMPT_VERSIONS.summary).toBe('summary@4');
		expect(PROMPT_VERSIONS.tagging).toBe('tagging@2');
		expect(PROMPT_VERSIONS.clustering).toBe('clustering@3');
	});

	it.each([
		['an overlong update_th', { update_th: 'ก'.repeat(301), update_refs: ['a1'] }],
		['an update_th of the wrong type', { update_th: 42, update_refs: ['a1'] }],
		['update_refs of the wrong type', { update_th: 'มีข้อมูลใหม่', update_refs: 'a1' }]
	])('%s never invalidates the summary; it only drops the timeline fields', (_label, fields) => {
		const result = validateOutput(TASK_DEFINITIONS.summary, SUMMARY_INPUT, {
			...VALID_SUMMARY,
			...fields
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.title_th).toBe(VALID_SUMMARY.title_th);
		const dropped = typeof fields.update_th !== 'string' || fields.update_th.length > 300;
		if (dropped) expect(result.data.update_th).toBeNull();
		if (!Array.isArray(fields.update_refs)) expect(result.data.update_refs).toEqual([]);
	});

	it('clustering rationale_th is optional and lenient too', () => {
		const input = {
			pairs: [
				{
					pair_ref: 'p1',
					a: { title: 'a', summary: null, published_at: null, tags: [] },
					b: { title: 'b', summary: null, published_at: null, tags: [] }
				}
			]
		};
		const decision = { pair_ref: 'p1', verdict: 'related', confidence: 0.5 };
		for (const rationale of [undefined, 7, 'ก'.repeat(301)]) {
			const result = validateOutput(TASK_DEFINITIONS.clustering, input, {
				decisions: [{ ...decision, rationale_th: rationale }]
			});
			expect(result.ok && result.data.decisions[0]!.rationale_th).toBeNull();
		}
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

describe('generated text normalization (security wave)', () => {
	it('stores every text field without format characters and NFKC-folded, Thai SARA AM intact', () => {
		const hidden = String.fromCodePoint(0x200b, 0x202e);
		const fullwidthEvil = String.fromCodePoint(0xff45, 0xff56, 0xff49, 0xff4c);
		const result = validateOutput(TASK_DEFINITIONS.summary, SUMMARY_INPUT, {
			...VALID_SUMMARY,
			title_th: `น้ำท่วม${hidden}ภาคใต้`,
			background_th: `ดูที่ ${fullwidthEvil}.com`,
			claims_th: [{ claimant_th: `กรม${hidden}อุตุ`, claim_th: 'ฝนตกหนัก', evidence: ['a1'] }]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.title_th).toBe('น้ำท่วมภาคใต้');
		expect(result.data.background_th).toBe('ดูที่ evil.com');
		expect(result.data.claims_th[0]?.claimant_th).toBe('กรมอุตุ');
	});
});
