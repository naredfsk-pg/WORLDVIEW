/**
 * Task-level `LLMProvider` (ARCHITECTURE §10). For each model in the route (primary, then the
 * cross-vendor fallback):
 *   1. cache lookup (a hit makes no network call and does not count toward caps)
 *   2. inside the concurrency limit: abort re-check, then the daily budget check
 *      (`budget_exceeded` never falls back)
 *   3. HTTP call with bounded retries + backoff; JSON mode first, and one retry without it on a 400
 *   4. JSON extraction + Zod + ref validation
 *   5. one schema-repair turn on the same model, then the next model
 * Every request that was sent is recorded in `llm_calls`. Expected failures are returned as
 * `LlmResult`, never thrown. Each `run` has a total deadline (default 10 min) on top of the
 * caller's signal, so a job's 20-minute abort is never the first limit hit.
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
import type { RetryPolicy } from '../../types/jobs';
import { bangkokDayRangeUtc, todayBriefDate } from '../../utils/date';
import { backoffDelayMs } from '../../utils/retry';
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
	/** Total time budget of one `run` (all models, retries and repair turns). */
	runDeadlineMs?: number;
}

/** ARCHITECTURE §8: LLM HTTP backoff base 2 s, max 30 s. */
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30_000;
/** Well under the 20-minute job abort (§8). */
const DEFAULT_RUN_DEADLINE_MS = 10 * 60_000;
const JSON_MODE = { type: 'json_object' } as const;

/** Per-run state shared by the steps below. */
interface RunContext<T extends LlmTask> {
	task: T;
	definition: TaskDefinition<T>;
	input: LlmInput<T>;
	messages: ChatMessage[];
	/** Caller signal combined with the run deadline. */
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
	| {
			ok: false;
			error: LlmError;
			/** Null when nothing was sent (abort, budget). */
			errorClass: TransportErrorClass | null;
			retryable: boolean;
			retryAfterMs: number | null;
	  };

/** What `llm_calls` and the log get for one sent request. */
interface CallRecord {
	status: 'ok' | 'error';
	errorKind: LlmErrorKind | null;
	errorClass: LlmLogEntry['error_class'];
	tokensIn: number;
	tokensOut: number;
	latencyMs: number;
	outputJson: string | null;
}

export function createLlmProvider(deps: LlmProviderDeps): LLMProvider {
	const { transport, calls, settings } = deps;
	const now = deps.now ?? (() => new Date());
	const sleep = deps.sleep ?? sleepUnlessAborted;
	const random = deps.random ?? Math.random;
	const log = deps.log ?? ((entry: LlmLogEntry) => console.info(JSON.stringify(entry)));
	const runDeadlineMs = deps.runDeadlineMs ?? DEFAULT_RUN_DEADLINE_MS;
	const limit = createConcurrencyLimit(settings.maxConcurrency);
	const backoffPolicy: RetryPolicy = {
		max_attempts: 1 + settings.maxRetries,
		base_delay_ms: BACKOFF_BASE_MS,
		max_delay_ms: BACKOFF_MAX_MS
	};
	/**
	 * Budget checks and call recording take turns, so a check never sees a call both as an
	 * `llm_calls` row and as in flight, nor misses one in between.
	 */
	const withBudgetLock = createSerialQueue();
	/** Calls that passed the budget check and are not recorded yet (at most `maxConcurrency`). */
	const inFlight = { requests: 0, tokens: 0 };
	/** Models that rejected JSON mode with a 400 and then worked without it (per process). */
	const modelsWithoutJsonMode = new Set<string>();

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

		const articleError = checkArticleCount(input, definition.maxArticles, route.primary);
		if (articleError) return { ok: false, error: articleError };

		const messages = buildTaskMessages(definition.systemPrompt, input);
		const estimatedTokens = estimateTokens(joinContent(messages));
		if (estimatedTokens > settings.maxInputTokens) {
			return failure('input_too_large', `estimated ${estimatedTokens} input tokens`, route.primary);
		}

		const deadline = new AbortController();
		const deadlineTimer = setTimeout(() => deadline.abort(), runDeadlineMs);
		const context: RunContext<T> = {
			task,
			definition,
			input,
			messages,
			signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
			jobRunId: options.job_run_id ?? null,
			tokensIn: 0,
			tokensOut: 0
		};
		const models = route.fallback ? [route.primary, route.fallback] : [route.primary];

		try {
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
				// The budget is global, and an abort or expired deadline ends the run: no fallback.
				if (lastError.kind === 'budget_exceeded' || context.signal.aborted) break;
			}

			if (deadline.signal.aborted && !options.signal?.aborted) {
				return failure('timeout', 'run deadline exceeded', lastError.model);
			}
			return { ok: false, error: lastError };
		} finally {
			clearTimeout(deadlineTimer);
		}
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
		let jsonMode = !modelsWithoutJsonMode.has(model);
		let retriesLeft = settings.maxRetries;

		for (;;) {
			const call = await callOnce(context, model, cacheKey, messages, jsonMode);
			if (!call.ok && call.errorClass === 'bad_request' && jsonMode) {
				// Some models reject `response_format`: one immediate retry without it (not a backoff retry).
				jsonMode = false;
				continue;
			}
			if (call.ok && !jsonMode) modelsWithoutJsonMode.add(model);
			if (call.ok || !call.retryable || retriesLeft === 0) return call;

			retriesLeft--;
			const attempt = settings.maxRetries - retriesLeft;
			const delayMs = backoffDelayMs(attempt, backoffPolicy, random(), call.retryAfterMs);
			await sleep(delayMs, context.signal);
			if (context.signal.aborted) return notSent(abortedError(model));
		}
	}

	async function callOnce<T extends LlmTask>(
		context: RunContext<T>,
		model: string,
		cacheKey: string,
		messages: ChatMessage[],
		jsonMode: boolean
	): Promise<NetworkCall<T>> {
		const estimatedTokensIn = estimateTokens(joinContent(messages));

		return limit(async () => {
			// Re-check after waiting for a slot: an abort while queued sends and records nothing.
			if (context.signal.aborted) return notSent(abortedError(model));

			const budgetError = await withBudgetLock(() => reserveBudget(model, estimatedTokensIn));
			if (budgetError) return notSent(budgetError);

			const sent = await sendAndValidate(
				context,
				model,
				messages,
				jsonMode,
				estimatedTokensIn
			).catch((error: unknown) => {
				releaseBudget(estimatedTokensIn);
				throw error;
			});
			await withBudgetLock(() =>
				recordCall(context, model, cacheKey, sent.record).finally(() =>
					releaseBudget(estimatedTokensIn)
				)
			);
			return sent.call;
		});
	}

	async function reserveBudget(model: string, estimatedTokensIn: number): Promise<LlmError | null> {
		const usage = await calls.usageSince(bangkokDayRangeUtc(todayBriefDate(now())).start_utc);
		if (usage.requests + inFlight.requests + 1 > settings.dailyMaxRequests) {
			return { kind: 'budget_exceeded', message: 'daily request cap reached', model };
		}
		if (usage.tokens + inFlight.tokens + estimatedTokensIn > settings.dailyMaxTokens) {
			return { kind: 'budget_exceeded', message: 'daily token cap reached', model };
		}
		inFlight.requests++;
		inFlight.tokens += estimatedTokensIn;
		return null;
	}

	function releaseBudget(estimatedTokensIn: number): void {
		inFlight.requests--;
		inFlight.tokens -= estimatedTokensIn;
	}

	async function sendAndValidate<T extends LlmTask>(
		context: RunContext<T>,
		model: string,
		messages: ChatMessage[],
		jsonMode: boolean,
		estimatedTokensIn: number
	): Promise<{ call: NetworkCall<T>; record: CallRecord }> {
		const startedAt = performance.now();
		const outcome = await sendRequest(model, messages, jsonMode, context.signal);
		const latencyMs = Math.round(performance.now() - startedAt);

		// A sent request costs at least its estimated input, even when it fails or times out, and
		// the proxy's reported usage is never trusted below that estimate.
		const tokensIn = Math.max(
			outcome.ok ? (outcome.response.tokens_in ?? 0) : 0,
			estimatedTokensIn
		);
		const tokensOut = outcome.ok ? (outcome.response.tokens_out ?? 0) : 0;
		context.tokensIn += tokensIn;
		context.tokensOut += tokensOut;

		if (!outcome.ok) {
			const { error } = outcome;
			return {
				call: {
					ok: false,
					error: { kind: error.kind, message: error.message, model },
					errorClass: error.errorClass,
					retryable: error.retryable,
					retryAfterMs: error.retryAfterMs
				},
				record: {
					status: 'error',
					errorKind: error.kind,
					errorClass: error.errorClass,
					tokensIn,
					tokensOut,
					latencyMs,
					outputJson: null
				}
			};
		}

		const { content } = outcome.response;
		const extracted = extractJsonObject(content);
		const validation: OutputValidation<T> = extracted.ok
			? validateOutput(context.definition, context.input, extracted.value)
			: { ok: false, issues: [extracted.reason] };
		return {
			call: { ok: true, content, validation },
			record: {
				status: validation.ok ? 'ok' : 'error',
				errorKind: validation.ok ? null : 'invalid_output',
				errorClass: validation.ok ? null : 'schema_invalid',
				tokensIn,
				tokensOut,
				latencyMs,
				outputJson: validation.ok ? JSON.stringify(validation.data) : null
			}
		};
	}

	async function sendRequest(
		model: string,
		messages: ChatMessage[],
		jsonMode: boolean,
		signal: AbortSignal
	) {
		const omitTemperature = shouldOmitTemperature(model, settings.omitTemperatureFor);
		try {
			const response = await transport.complete({
				model,
				messages,
				max_tokens: settings.maxOutputTokens,
				...(omitTemperature ? {} : { temperature: settings.temperature }),
				...(jsonMode ? { response_format: JSON_MODE } : {}),
				signal
			});
			return { ok: true as const, response };
		} catch (error) {
			// Unknown throwables (a transport bug) are `internal`: never retried.
			const transportError =
				error instanceof LlmTransportError ? error : new LlmTransportError('internal', null);
			return { ok: false as const, error: transportError };
		}
	}

	async function recordCall<T extends LlmTask>(
		context: RunContext<T>,
		model: string,
		cacheKey: string,
		call: CallRecord
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

/**
 * ARCHITECTURE §10 input limits for tasks with an `articles` list: an empty list can never
 * succeed (`invalid_request`) and an oversized one must be split by the builder
 * (`input_too_large`). Neither sends a request.
 */
function checkArticleCount(
	input: object,
	maxArticles: number | null,
	model: string
): LlmError | null {
	if (maxArticles === null || !('articles' in input) || !Array.isArray(input.articles)) {
		return null;
	}
	const count = input.articles.length;
	if (count === 0) return { kind: 'invalid_request', message: 'no articles in input', model };
	if (count > maxArticles) {
		return { kind: 'input_too_large', message: `${count} articles (max ${maxArticles})`, model };
	}
	return null;
}

function joinContent(messages: ChatMessage[]): string {
	return messages.map((message) => message.content).join('');
}

function failure(
	kind: LlmErrorKind,
	message: string,
	model: string | null
): { ok: false; error: LlmError } {
	return { ok: false, error: { kind, message, model } };
}

function abortedError(model: string): LlmError {
	return { kind: 'aborted', message: 'aborted', model };
}

/** A failure decided before any request was sent (abort, budget): never retried, never recorded. */
function notSent(error: LlmError) {
	return { ok: false as const, error, errorClass: null, retryable: false, retryAfterMs: null };
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

/** Runs the given async steps one at a time, in call order. */
function createSerialQueue() {
	let tail: Promise<unknown> = Promise.resolve();

	return function serialize<R>(fn: () => Promise<R>): Promise<R> {
		const result = tail.then(fn);
		tail = result.catch(() => undefined);
		return result;
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
