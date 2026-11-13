/**
 * Task-level `LLMProvider` (ARCHITECTURE §10). For each model in the route (primary, then the
 * cross-vendor fallback):
 *   1. cache lookup (a hit makes no network call and does not count toward caps)
 *   2. daily budget check before every network call (`budget_exceeded` never falls back)
 *   3. HTTP call with bounded retries + backoff, under the concurrency limit
 *   4. JSON extraction + Zod + ref validation
 *   5. one schema-repair turn on the same model, then the next model
 * Every network call is recorded in `llm_calls`. Expected failures are returned as `LlmResult`.
 */
import type { LlmCallRepository } from '../../types/repositories';
import type {
	ChatMessage,
	ChatTransport,
	LlmCallOptions,
	LlmError,
	LlmErrorKind,
	LlmInput,
	LlmOutput,
	LLMProvider,
	LlmResult,
	LlmTask
} from '../../types/llm';
import { toBriefDate } from '../../utils/date';
import { computeCacheKey } from './cache-key';
import { extractJsonObject } from './json';
import { buildRepairMessages, buildTaskMessages, estimateTokens } from './prompt';
import { resolveModelRoute, shouldOmitTemperature, type LlmModelSettings } from './routing';
import { TASK_DEFINITIONS, type TaskDefinition } from './tasks';
import { validateOutput, type OutputValidation } from './tasks/shared';
import { LlmTransportError, type TransportErrorClass } from './transport';

/** Same field names as `AppConfig['llm']`, so `config.llm` can be passed as-is. */
export interface LlmSettings {
	models: LlmModelSettings;
	omitTemperatureFor: string[];
	maxConcurrency: number;
	maxRetries: number;
	maxInputTokens: number;
	maxOutputTokens: number;
	temperature: number;
	dailyMaxRequests: number;
	dailyMaxTokens: number;
}

/** One line per network call. Never contains prompts, source text, headers or keys. */
export interface LlmLogEntry {
	scope: 'llm';
	task: LlmTask;
	model: string;
	status: 'ok' | 'error';
	error_class: TransportErrorClass | 'schema_invalid' | null;
	latency_ms: number;
	tokens_in: number;
	tokens_out: number;
}

export interface LlmProviderDeps {
	transport: ChatTransport;
	calls: LlmCallRepository;
	settings: LlmSettings;
	now?: () => Date;
	/** Backoff sleep; injected by tests. Resolves early when the signal aborts. */
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	random?: () => number;
	log?: (entry: LlmLogEntry) => void;
}

/** ARCHITECTURE §8: LLM HTTP backoff base 2 s, max 30 s. */
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30_000;

/** Per-run state shared by the steps below. */
interface RunContext<T extends LlmTask> {
	task: T;
	definition: TaskDefinition<T>;
	input: LlmInput<T>;
	messages: ChatMessage[];
	signal: AbortSignal;
	jobRunId: string | null;
	tokensIn: number;
	tokensOut: number;
}

type ModelAttempt<T extends LlmTask> =
	| { ok: true; data: LlmOutput<T>; cacheKey: string; cached: boolean }
	| { ok: false; error: LlmError };

type NetworkCall<T extends LlmTask> =
	| { ok: true; content: string; validation: OutputValidation<T> }
	| { ok: false; error: LlmError; retryable: boolean; retryAfterMs: number | null };

export function createLlmProvider(deps: LlmProviderDeps): LLMProvider {
	const { transport, calls, settings } = deps;
	const now = deps.now ?? (() => new Date());
	const sleep = deps.sleep ?? sleepUnlessAborted;
	const random = deps.random ?? Math.random;
	const log = deps.log ?? ((entry: LlmLogEntry) => console.info(JSON.stringify(entry)));
	const limit = createConcurrencyLimit(settings.maxConcurrency);
	/** Calls that passed the budget check but are not recorded yet (keeps caps tight under concurrency). */
	let reservedRequests = 0;

	return { run };

	async function run<T extends LlmTask>(
		task: T,
		input: LlmInput<T>,
		options: LlmCallOptions = {}
	): Promise<LlmResult<LlmOutput<T>>> {
		const startedAt = performance.now();
		const definition = TASK_DEFINITIONS[task];
		const route = resolveModelRoute(task, settings.models);
		if (!route) return failure('not_configured', `no model configured for task ${task}`, null);

		const messages = buildTaskMessages(definition.systemPrompt, input);
		const estimatedTokens = estimateTokens(messages.map((message) => message.content).join(''));
		if (estimatedTokens > settings.maxInputTokens) {
			return failure('input_too_large', `estimated ${estimatedTokens} input tokens`, route.primary);
		}

		const context: RunContext<T> = {
			task,
			definition,
			input,
			messages,
			signal: options.signal ?? new AbortController().signal,
			jobRunId: options.job_run_id ?? null,
			tokensIn: 0,
			tokensOut: 0
		};
		const models = route.fallback ? [route.primary, route.fallback] : [route.primary];

		let lastError: LlmError = { kind: 'http_error', message: 'no model attempted', model: null };
		for (const [index, model] of models.entries()) {
			const attempt = await runOnModel(context, model);
			if (attempt.ok) {
				return {
					ok: true,
					data: attempt.data,
					meta: {
						task,
						model,
						prompt_version: definition.promptVersion,
						cache_key: attempt.cacheKey,
						cached: attempt.cached,
						fell_back: index > 0,
						tokens_in: context.tokensIn,
						tokens_out: context.tokensOut,
						latency_ms: Math.round(performance.now() - startedAt)
					}
				};
			}
			lastError = attempt.error;
			// The budget is global and an abort is the caller's decision: no fallback for either.
			if (lastError.kind === 'budget_exceeded' || lastError.kind === 'aborted') break;
		}
		return { ok: false, error: lastError };
	}

	async function runOnModel<T extends LlmTask>(
		context: RunContext<T>,
		model: string
	): Promise<ModelAttempt<T>> {
		const cacheKey = computeCacheKey({
			task: context.task,
			model,
			prompt_version: context.definition.promptVersion,
			input: context.input
		});

		const cached = await readCache(context, cacheKey);
		if (cached) return { ok: true, data: cached, cacheKey, cached: true };

		const first = await callWithRetries(context, model, cacheKey, context.messages);
		if (!first.ok) return first;
		if (first.validation.ok) {
			return { ok: true, data: first.validation.data, cacheKey, cached: false };
		}

		const repairMessages = buildRepairMessages(
			context.messages,
			first.content,
			first.validation.issues
		);
		const repaired = await callWithRetries(context, model, cacheKey, repairMessages);
		if (!repaired.ok) return repaired;
		if (repaired.validation.ok) {
			return { ok: true, data: repaired.validation.data, cacheKey, cached: false };
		}
		return failure('invalid_output', 'output failed validation after one repair turn', model);
	}

	async function readCache<T extends LlmTask>(
		context: RunContext<T>,
		cacheKey: string
	): Promise<LlmOutput<T> | null> {
		const json = await calls.findCachedOutput(cacheKey);
		if (json === null) return null;

		let value: unknown;
		try {
			value = JSON.parse(json);
		} catch {
			return null;
		}
		// Re-validate: a stale or corrupt row is ignored rather than trusted.
		const validation = validateOutput(context.definition, context.input, value);
		return validation.ok ? validation.data : null;
	}

	async function callWithRetries<T extends LlmTask>(
		context: RunContext<T>,
		model: string,
		cacheKey: string,
		messages: ChatMessage[]
	): Promise<NetworkCall<T>> {
		for (let attempt = 1; ; attempt++) {
			const call = await callOnce(context, model, cacheKey, messages);
			if (call.ok || !call.retryable || attempt > settings.maxRetries) return call;

			await sleep(backoffDelay(attempt, call.retryAfterMs, random), context.signal);
			if (context.signal.aborted) return notSent({ kind: 'aborted', message: 'aborted', model });
		}
	}

	async function callOnce<T extends LlmTask>(
		context: RunContext<T>,
		model: string,
		cacheKey: string,
		messages: ChatMessage[]
	): Promise<NetworkCall<T>> {
		if (context.signal.aborted) return notSent({ kind: 'aborted', message: 'aborted', model });

		reservedRequests++;
		try {
			const budgetError = await checkBudget(model);
			if (budgetError) return notSent(budgetError);

			const startedAt = performance.now();
			const outcome = await limit(() => sendRequest(model, messages, context.signal));
			const latencyMs = Math.round(performance.now() - startedAt);

			if (!outcome.ok) {
				await recordCall(context, model, cacheKey, {
					status: 'error',
					errorKind: outcome.error.kind,
					errorClass: outcome.error.errorClass,
					tokensIn: 0,
					tokensOut: 0,
					latencyMs,
					outputJson: null
				});
				return {
					ok: false,
					error: { kind: outcome.error.kind, message: outcome.error.message, model },
					retryable: outcome.error.retryable,
					retryAfterMs: outcome.error.retryAfterMs
				};
			}

			const { response } = outcome;
			const tokensIn =
				response.tokens_in ?? estimateTokens(messages.map((m) => m.content).join(''));
			const tokensOut = response.tokens_out ?? estimateTokens(response.content);
			context.tokensIn += tokensIn;
			context.tokensOut += tokensOut;

			const extracted = extractJsonObject(response.content);
			const validation: OutputValidation<T> = extracted.ok
				? validateOutput(context.definition, context.input, extracted.value)
				: { ok: false, issues: [extracted.reason] };

			await recordCall(context, model, cacheKey, {
				status: validation.ok ? 'ok' : 'error',
				errorKind: validation.ok ? null : 'invalid_output',
				errorClass: validation.ok ? null : 'schema_invalid',
				tokensIn,
				tokensOut,
				latencyMs,
				outputJson: validation.ok ? JSON.stringify(validation.data) : null
			});
			return { ok: true, content: response.content, validation };
		} finally {
			reservedRequests--;
		}
	}

	async function checkBudget(model: string): Promise<LlmError | null> {
		const usage = await calls.usageSince(bangkokDayStartUtc(now()));
		// `reservedRequests` already includes this call.
		if (usage.requests + reservedRequests > settings.dailyMaxRequests) {
			return { kind: 'budget_exceeded', message: 'daily request cap reached', model };
		}
		if (usage.tokens >= settings.dailyMaxTokens) {
			return { kind: 'budget_exceeded', message: 'daily token cap reached', model };
		}
		return null;
	}

	async function sendRequest(model: string, messages: ChatMessage[], signal: AbortSignal) {
		const omitTemperature = shouldOmitTemperature(model, settings.omitTemperatureFor);
		try {
			const response = await transport.complete({
				model,
				messages,
				max_tokens: settings.maxOutputTokens,
				...(omitTemperature ? {} : { temperature: settings.temperature }),
				signal
			});
			return { ok: true as const, response };
		} catch (error) {
			// Unknown throwables (a transport bug) become a non-retryable network-class error.
			const transportError =
				error instanceof LlmTransportError ? error : new LlmTransportError('network', null);
			return { ok: false as const, error: transportError };
		}
	}

	async function recordCall<T extends LlmTask>(
		context: RunContext<T>,
		model: string,
		cacheKey: string,
		call: {
			status: 'ok' | 'error';
			errorKind: LlmErrorKind | null;
			errorClass: LlmLogEntry['error_class'];
			tokensIn: number;
			tokensOut: number;
			latencyMs: number;
			outputJson: string | null;
		}
	): Promise<void> {
		await calls.record({
			created_at: now().toISOString(),
			task: context.task,
			model,
			prompt_version: context.definition.promptVersion,
			cache_key: cacheKey,
			status: call.status,
			error_kind: call.errorKind,
			tokens_in: call.tokensIn,
			tokens_out: call.tokensOut,
			latency_ms: call.latencyMs,
			output_json: call.outputJson,
			job_run_id: context.jobRunId
		});
		log({
			scope: 'llm',
			task: context.task,
			model,
			status: call.status,
			error_class: call.errorClass,
			latency_ms: call.latencyMs,
			tokens_in: call.tokensIn,
			tokens_out: call.tokensOut
		});
	}
}

/** `min(max, base·2^(n-1)) · rand(0.5..1)`; a `Retry-After` value wins, capped at max. */
export function backoffDelay(
	attempt: number,
	retryAfterMs: number | null,
	random: () => number = Math.random
): number {
	if (retryAfterMs !== null) return Math.min(BACKOFF_MAX_MS, retryAfterMs);
	const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
	return exponential * (0.5 + random() * 0.5);
}

/** Start of the current Asia/Bangkok day as UTC (ICT is a fixed UTC+7, no DST). */
export function bangkokDayStartUtc(instant: Date): string {
	return new Date(`${toBriefDate(instant.toISOString())}T00:00:00+07:00`).toISOString();
}

function failure(
	kind: LlmErrorKind,
	message: string,
	model: string | null
): { ok: false; error: LlmError } {
	return { ok: false, error: { kind, message, model } };
}

/** A failure decided before any request was sent (abort, budget): never retried. */
function notSent(error: LlmError) {
	return { ok: false as const, error, retryable: false, retryAfterMs: null };
}

function createConcurrencyLimit(max: number) {
	let active = 0;
	const waiting: (() => void)[] = [];

	return async function limit<R>(fn: () => Promise<R>): Promise<R> {
		while (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
		try {
			return await fn();
		} finally {
			active--;
			waiting.shift()?.();
		}
	};
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		signal.addEventListener('abort', done, { once: true });
		function done() {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		}
	});
}
