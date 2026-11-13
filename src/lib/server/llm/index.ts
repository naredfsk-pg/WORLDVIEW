/**
 * `#lib/server/llm` public surface. Composition roots (scripts, jobs wiring) call
 * `createLlmProviderFromConfig(getConfig().llm, repositories.llmCalls)`; tests build
 * `createLlmProvider` with a `createMockTransport`, or use `createMockLlmProvider`.
 */
import type { LlmCallRepository } from '../../types/repositories';
import type { LLMProvider } from '../../types/llm';
import { createLlmProvider, type LlmProviderDeps, type LlmSettings } from './provider';
import { createOpenAiCompatibleTransport } from './transport';

export { createLlmProvider } from './provider';
export type { LlmLogEntry, LlmProviderDeps, LlmSettings } from './provider';
export { resolveModelRoute, shouldOmitTemperature, type LlmModelSettings } from './routing';
export { computeCacheKey, canonicalJson } from './cache-key';
export { PROMPT_VERSIONS, TASK_DEFINITIONS } from './tasks';
export {
	createOpenAiCompatibleTransport,
	chatCompletionsUrl,
	LlmTransportError,
	type TransportErrorClass
} from './transport';
export {
	createMockLlmProvider,
	createDefaultMockHandlers,
	createMockTransport,
	mockLlmError,
	type MockFailureMode,
	type MockTransport,
	type MockTransportStep
} from './mock';

/** Same field names as `AppConfig['llm']`. */
export interface LlmConfig extends LlmSettings {
	baseUrl: string | undefined;
	apiKey: string | undefined;
	compatibility: 'openai_compatible' | 'custom';
	timeoutSeconds: number;
}

/**
 * Real provider from config. Missing endpoint or key, or `LLM_API_COMPATIBILITY=custom`
 * (unsupported in the MVP), gives a provider whose every call returns `not_configured`.
 */
export function createLlmProviderFromConfig(
	config: LlmConfig,
	calls: LlmCallRepository,
	overrides: Omit<LlmProviderDeps, 'transport' | 'calls' | 'settings'> = {}
): LLMProvider {
	const { baseUrl, apiKey } = config;
	if (!baseUrl || !apiKey || config.compatibility !== 'openai_compatible') {
		return {
			async run() {
				return {
					ok: false,
					error: { kind: 'not_configured', message: 'LLM endpoint is not configured', model: null }
				};
			}
		};
	}

	const transport = createOpenAiCompatibleTransport({
		baseUrl,
		apiKey,
		timeoutSeconds: config.timeoutSeconds
	});
	return createLlmProvider({ ...overrides, transport, calls, settings: config });
}
