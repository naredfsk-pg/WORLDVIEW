/**
 * OpenAI-compatible `ChatTransport` (ARCHITECTURE §10): one HTTP attempt per `complete` call.
 * Retries, caps, caching and logging live in the provider; this module only maps the wire format
 * and HTTP failures to typed `LlmTransportError`s. It never logs, and it never puts the API key,
 * headers, prompt or response body into an error message.
 */
import { z } from 'zod';
import type { ChatRequest, ChatResponse, ChatTransport, LlmErrorKind } from '../../types/llm';

export interface OpenAiTransportOptions {
	baseUrl: string;
	apiKey: string;
	timeoutSeconds: number;
	/** Injected in tests; defaults to the global `fetch`. */
	fetch?: typeof fetch;
}

export type TransportErrorClass =
	| 'auth'
	| 'rate_limit'
	| 'server'
	| 'timeout'
	| 'bad_request'
	| 'invalid_json'
	| 'network'
	| 'aborted'
	/** A non-transport throwable (a bug); never retried. */
	| 'internal';

const ERROR_KIND_BY_CLASS: Record<TransportErrorClass, LlmErrorKind> = {
	auth: 'invalid_request',
	rate_limit: 'rate_limited',
	server: 'http_error',
	timeout: 'timeout',
	bad_request: 'invalid_request',
	invalid_json: 'http_error',
	network: 'http_error',
	aborted: 'aborted',
	internal: 'http_error'
};

const RETRYABLE_CLASSES: ReadonlySet<TransportErrorClass> = new Set([
	'rate_limit',
	'server',
	'timeout',
	'network'
]);

/** Thrown by `ChatTransport.complete`. The message is only the class and HTTP status. */
export class LlmTransportError extends Error {
	override name = 'LlmTransportError';
	readonly kind: LlmErrorKind;
	readonly retryable: boolean;

	constructor(
		readonly errorClass: TransportErrorClass,
		readonly status: number | null,
		/** From `Retry-After` on a 429; null when absent or unparseable. */
		readonly retryAfterMs: number | null = null
	) {
		super(status === null ? errorClass : `${errorClass} (HTTP ${status})`);
		this.kind = ERROR_KIND_BY_CLASS[errorClass];
		this.retryable = RETRYABLE_CLASSES.has(errorClass);
	}
}

export function createOpenAiCompatibleTransport(options: OpenAiTransportOptions): ChatTransport {
	const url = chatCompletionsUrl(options.baseUrl);
	const timeoutMs = options.timeoutSeconds * 1000;
	const fetchImpl = options.fetch ?? fetch;

	return {
		async complete(request) {
			const timeout = new AbortController();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				timeout.abort();
			}, timeoutMs);

			try {
				const response = await fetchImpl(url, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${options.apiKey}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify(toRequestBody(request)),
					signal: AbortSignal.any([request.signal, timeout.signal])
				});
				// Read the body inside the timeout window: a stalled body is a timeout too.
				const text = await response.text();
				if (!response.ok) {
					throw errorForStatus(response.status, response.headers.get('retry-after'));
				}
				return parseCompletion(text);
			} catch (error) {
				if (error instanceof LlmTransportError) throw error;
				if (timedOut) throw new LlmTransportError('timeout', null);
				if (request.signal.aborted) throw new LlmTransportError('aborted', null);
				throw new LlmTransportError('network', null);
			} finally {
				clearTimeout(timer);
			}
		}
	};
}

/** `LLM_BASE_URL` may already end in `/v1` (omniroute does); never add it twice. */
export function chatCompletionsUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, '');
	return trimmed.endsWith('/v1') ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

function toRequestBody(request: ChatRequest) {
	return {
		model: request.model,
		messages: request.messages,
		max_tokens: request.max_tokens,
		// The key is left out entirely for models that reject it (LLM_OMIT_TEMPERATURE_FOR).
		...(request.temperature === undefined ? {} : { temperature: request.temperature }),
		// JSON mode when the provider asks for it; output parsing never depends on it.
		...(request.response_format ? { response_format: request.response_format } : {})
	};
}

function errorForStatus(status: number, retryAfter: string | null): LlmTransportError {
	if (status === 401 || status === 403) return new LlmTransportError('auth', status);
	if (status === 408) return new LlmTransportError('timeout', status);
	if (status === 429) {
		return new LlmTransportError('rate_limit', status, parseRetryAfter(retryAfter));
	}
	if (status >= 500) return new LlmTransportError('server', status);
	return new LlmTransportError('bad_request', status);
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: Date = new Date()): number | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) return null;
	return Math.max(0, date - now.getTime());
}

const completionSchema = z.object({
	choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
	usage: z
		.object({
			prompt_tokens: z.number().optional(),
			completion_tokens: z.number().optional(),
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional()
		})
		.nullish()
});

function parseCompletion(text: string): ChatResponse {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new LlmTransportError('invalid_json', 200);
	}

	// A 200 carrying an error envelope (Anthropic or OpenAI style) is a failure, even though it parses.
	if (isErrorEnvelope(body)) throw new LlmTransportError('server', 200);

	const parsed = completionSchema.safeParse(body);
	if (!parsed.success) throw new LlmTransportError('invalid_json', 200);

	const usage = parsed.data.usage;
	return {
		content: parsed.data.choices[0]?.message.content ?? '',
		tokens_in: usage?.prompt_tokens ?? usage?.input_tokens ?? null,
		tokens_out: usage?.completion_tokens ?? usage?.output_tokens ?? null
	};
}

function isErrorEnvelope(body: unknown): boolean {
	if (typeof body !== 'object' || body === null) return false;
	const record = body as Record<string, unknown>;
	return record.type === 'error' || (record.error != null && !('choices' in record));
}
