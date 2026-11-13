/**
 * Test and local-dev doubles (ARCHITECTURE §10 "Mock"). Never touch the network.
 * - `createMockLlmProvider(handlers)`: task-level double for jobs and editorial tests. Handler
 *   output goes through the same Zod + ref validation as real output.
 * - `createDefaultMockHandlers()`: deterministic, schema-valid outputs for every task (local dev).
 * - `createMockTransport(steps)`: transport-level double for routing, fallback, cache and cap tests,
 *   with failure modes (timeout, 429, invalid JSON, schema-invalid).
 */
import type {
	ChatRequest,
	ChatResponse,
	ChatTransport,
	LlmError,
	LlmErrorKind,
	LlmInput,
	LlmOutput,
	LLMProvider,
	LlmTask,
	MockLlmHandlers
} from '../../types/llm';
import { computeCacheKey } from './cache-key';
import { TASK_DEFINITIONS } from './tasks';
import { validateOutput } from './tasks/shared';
import { LlmTransportError } from './transport';

const MOCK_MODEL = 'mock';

export function createMockLlmProvider(handlers: MockLlmHandlers): LLMProvider {
	return {
		async run<T extends LlmTask>(task: T, input: LlmInput<T>) {
			const handler = handlers[task] as
				((input: LlmInput<T>) => LlmOutput<T> | LlmError) | undefined;
			if (!handler) return mockFailure('not_configured', `no mock handler for ${task}`);

			const output = handler(input);
			if (isLlmError(output)) return { ok: false as const, error: output };

			const definition = TASK_DEFINITIONS[task];
			const validation = validateOutput(definition, input, output);
			if (!validation.ok) return mockFailure('invalid_output', validation.issues.join('; '));

			return {
				ok: true as const,
				data: validation.data,
				meta: {
					task,
					model: MOCK_MODEL,
					prompt_version: definition.promptVersion,
					cache_key: computeCacheKey({
						task,
						model: MOCK_MODEL,
						prompt_version: definition.promptVersion,
						input
					}),
					cached: false,
					fell_back: false,
					tokens_in: 0,
					tokens_out: 0,
					latency_ms: 0
				}
			};
		}
	};
}

/** Return this from a handler to simulate a provider failure (`timeout`, `budget_exceeded`, …). */
export function mockLlmError(kind: LlmErrorKind, message: string = `mock ${kind}`): LlmError {
	return { kind, message, model: MOCK_MODEL };
}

/** Deterministic outputs derived from the input. Text is placeholder Thai, clearly not news. */
export function createDefaultMockHandlers(): Required<MockLlmHandlers> {
	return {
		tagging: (input) => ({
			items: input.articles.map((article) => ({
				ref: article.ref,
				category: 'geopolitics',
				regions: ['global'],
				countries: [],
				tags: ['world-news']
			}))
		}),
		clustering: (input) => ({
			// Conservative: a wrong merge is worse than a duplicate (ARCHITECTURE §9).
			decisions: input.pairs.map((pair) => ({
				pair_ref: pair.pair_ref,
				verdict: 'unrelated',
				confidence: 0.5
			}))
		}),
		extraction: (input) => ({
			facts: input.articles.map((article) => ({ text: article.title, evidence: [article.ref] })),
			claims: [],
			occurred_at: null,
			countries: [],
			sensitive: false,
			open_questions: []
		}),
		summary: (input) => ({
			title_th: `เหตุการณ์ตัวอย่างจาก ${input.articles.length} แหล่งข่าว`,
			summary_th: 'ข้อความสรุปตัวอย่างที่สร้างโดยระบบทดสอบ',
			what_happened_th: 'รายละเอียดตัวอย่างของสิ่งที่เกิดขึ้นตามแหล่งข่าว',
			why_it_matters_th: 'คำอธิบายตัวอย่างว่าเหตุใดเหตุการณ์นี้จึงสำคัญ',
			background_th: null,
			uncertain_th: 'ไม่แน่ชัด',
			claims_th: [],
			impact_breadth: 1,
			thailand_relevance: 1,
			cited_refs: input.articles.map((article) => article.ref),
			update_th:
				input.previous && input.previous.new_refs.length > 0
					? `ข้อมูลใหม่ตัวอย่างจาก ${input.previous.new_refs.length} แหล่งข่าว`
					: null
		}),
		relations: () => ({ relations: [] }),
		academy_linking: (input) => ({
			links: input.lessons.slice(0, 1).map((lesson) => ({
				lesson_id: lesson.lesson_id,
				rationale_th: 'บทเรียนนี้ให้พื้นฐานที่ช่วยให้เข้าใจเหตุการณ์'
			}))
		})
	};
}

export type MockFailureMode =
	'timeout' | 'rate_limited' | 'server_error' | 'bad_request' | 'invalid_json' | 'schema_invalid';

/** One scripted transport reply: model content, a failure mode, or a function of the request. */
export type MockTransportStep =
	| { content: string; tokens_in?: number; tokens_out?: number }
	| { fail: MockFailureMode; retry_after_seconds?: number }
	| ((request: ChatRequest) => MockTransportStep);

export interface MockTransport extends ChatTransport {
	/** Every request received, in order (the signal included). */
	requests: ChatRequest[];
}

/** Replies with `steps` in order; the last step repeats once the script runs out. */
export function createMockTransport(steps: MockTransportStep[]): MockTransport {
	const requests: ChatRequest[] = [];
	return {
		requests,
		async complete(request) {
			requests.push(request);
			const step = steps[Math.min(requests.length, steps.length) - 1];
			if (!step) throw new LlmTransportError('server', 500);
			return replyFor(step, request);
		}
	};
}

function replyFor(step: MockTransportStep, request: ChatRequest): ChatResponse {
	if (typeof step === 'function') return replyFor(step(request), request);
	if ('content' in step) {
		return {
			content: step.content,
			tokens_in: step.tokens_in ?? 10,
			tokens_out: step.tokens_out ?? 10
		};
	}

	switch (step.fail) {
		case 'timeout':
			throw new LlmTransportError('timeout', null);
		case 'rate_limited':
			throw new LlmTransportError(
				'rate_limit',
				429,
				step.retry_after_seconds === undefined ? null : step.retry_after_seconds * 1000
			);
		case 'server_error':
			throw new LlmTransportError('server', 503);
		case 'bad_request':
			throw new LlmTransportError('bad_request', 400);
		case 'invalid_json':
			return { content: 'Sorry, I cannot help with that.', tokens_in: 10, tokens_out: 5 };
		case 'schema_invalid':
			return { content: '{"unexpected": true}', tokens_in: 10, tokens_out: 5 };
	}
}

function mockFailure(kind: LlmErrorKind, message: string) {
	return { ok: false as const, error: mockLlmError(kind, message) };
}

function isLlmError(value: unknown): value is LlmError {
	return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;
}
