import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../../types/llm';
import {
	chatCompletionsUrl,
	createOpenAiCompatibleTransport,
	LlmTransportError,
	MAX_RESPONSE_BYTES,
	parseRetryAfter
} from './transport';

const API_KEY = 'test-key-not-real';

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
	return {
		model: 'cc/model-a',
		messages: [
			{ role: 'system', content: 'rules' },
			{ role: 'user', content: '<data>{}</data>' }
		],
		max_tokens: 100,
		temperature: 0.1,
		response_format: { type: 'json_object' },
		signal: new AbortController().signal,
		...overrides
	};
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init
	});
}

const okBody = {
	choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
	usage: { prompt_tokens: 12, completion_tokens: 7 }
};

function transportWith(fetchImpl: typeof fetch, timeoutSeconds = 90) {
	return createOpenAiCompatibleTransport({
		baseUrl: 'https://llm.example.test/v1',
		apiKey: API_KEY,
		timeoutSeconds,
		fetch: fetchImpl
	});
}

async function captureError(promise: Promise<unknown>): Promise<LlmTransportError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof LlmTransportError) return error;
		throw error;
	}
	throw new Error('expected the call to fail');
}

afterEach(() => vi.useRealTimers());

describe('chatCompletionsUrl', () => {
	it('does not add /v1 twice', () => {
		expect(chatCompletionsUrl('https://h.test/v1')).toBe('https://h.test/v1/chat/completions');
		expect(chatCompletionsUrl('https://h.test/v1/')).toBe('https://h.test/v1/chat/completions');
		expect(chatCompletionsUrl('https://h.test')).toBe('https://h.test/v1/chat/completions');
	});
});

describe('createOpenAiCompatibleTransport', () => {
	it('posts an OpenAI-compatible body with bearer auth and returns content and usage', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(okBody));
		const response = await transportWith(fetchMock).complete(request());

		expect(response).toEqual({
			content: '```json\n{"ok":true}\n```',
			tokens_in: 12,
			tokens_out: 7
		});
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://llm.example.test/v1/chat/completions');
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
		expect(JSON.parse(String(init?.body))).toEqual({
			model: 'cc/model-a',
			messages: request().messages,
			max_tokens: 100,
			temperature: 0.1,
			response_format: { type: 'json_object' }
		});
	});

	it('leaves the temperature and response_format keys out when the request has none', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(okBody));
		await transportWith(fetchMock).complete(
			request({ temperature: undefined, response_format: undefined })
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
		expect('temperature' in body).toBe(false);
		expect('response_format' in body).toBe(false);
	});

	it('maps 429 to a retryable rate_limit error and honours Retry-After seconds', async () => {
		const fetchMock = vi.fn<typeof fetch>(
			async () =>
				new Response('{"type":"error","error":{"type":"rate_limit_error"}}', {
					status: 429,
					headers: { 'retry-after': '7' }
				})
		);
		const error = await captureError(transportWith(fetchMock).complete(request()));

		expect(error).toMatchObject({
			errorClass: 'rate_limit',
			kind: 'rate_limited',
			retryable: true,
			status: 429,
			retryAfterMs: 7000
		});
	});

	it.each([
		[401, 'auth', 'invalid_request', false],
		[403, 'auth', 'invalid_request', false],
		[400, 'bad_request', 'invalid_request', false],
		[408, 'timeout', 'timeout', true],
		[500, 'server', 'http_error', true],
		[503, 'server', 'http_error', true]
	])('maps HTTP %i to %s', async (status, errorClass, kind, retryable) => {
		// Anthropic-style and plain-text error bodies are both treated as errors, never as content.
		const body =
			status === 400 ? '{"type":"error","error":{"type":"invalid_request_error"}}' : 'Bad Gateway';
		const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { status }));
		const error = await captureError(transportWith(fetchMock).complete(request()));

		expect(error).toMatchObject({ errorClass, kind, retryable, status });
		expect(error.message).not.toContain(API_KEY);
		expect(error.message).not.toContain('invalid_request_error');
	});

	it('treats a 200 error envelope as a server error even though it parses', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
		);
		const error = await captureError(transportWith(fetchMock).complete(request()));
		expect(error).toMatchObject({ errorClass: 'server', retryable: true });
	});

	it('maps a non-JSON or malformed 200 body to invalid_json', async () => {
		const notJson = vi.fn<typeof fetch>(
			async () => new Response('<html>oops</html>', { status: 200 })
		);
		const noChoices = vi.fn<typeof fetch>(async () => jsonResponse({ id: 'x', choices: [] }));

		expect(await captureError(transportWith(notJson).complete(request()))).toMatchObject({
			errorClass: 'invalid_json',
			retryable: false
		});
		expect(await captureError(transportWith(noChoices).complete(request()))).toMatchObject({
			errorClass: 'invalid_json'
		});
	});

	it('times out after LLM_TIMEOUT_SECONDS', async () => {
		vi.useFakeTimers();
		const hangingFetch = vi.fn<typeof fetch>(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		);
		const pending = captureError(transportWith(hangingFetch, 5).complete(request()));
		await vi.advanceTimersByTimeAsync(5000);

		expect(await pending).toMatchObject({
			errorClass: 'timeout',
			kind: 'timeout',
			retryable: true
		});
	});

	it('reports a caller abort as aborted, not as a timeout', async () => {
		const controller = new AbortController();
		const hangingFetch = vi.fn<typeof fetch>(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		);
		const pending = captureError(
			transportWith(hangingFetch).complete(request({ signal: controller.signal }))
		);
		controller.abort();

		expect(await pending).toMatchObject({
			errorClass: 'aborted',
			kind: 'aborted',
			retryable: false
		});
	});

	it.each([301, 302, 307, 308])(
		'refuses to follow HTTP %i (non-retryable redirect)',
		async (status) => {
			const fetchMock = vi.fn<typeof fetch>(
				async () =>
					new Response(null, { status, headers: { location: 'https://elsewhere.test/collect' } })
			);
			const error = await captureError(transportWith(fetchMock).complete(request()));

			expect(fetchMock.mock.calls[0]![1]?.redirect).toBe('manual');
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(error).toMatchObject({ errorClass: 'redirect', retryable: false, status });
			expect(error.message).not.toContain('elsewhere');
		}
	);

	it('refuses a body over MAX_RESPONSE_BYTES while streaming, without reading the rest', async () => {
		const chunk = new Uint8Array(256 * 1024).fill(0x20);
		let pulled = 0;
		let cancelled = false;
		const fetchMock = vi.fn<typeof fetch>(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						// Endless body: only the cap can end the read.
						pull(controller) {
							pulled += 1;
							controller.enqueue(chunk);
						},
						cancel() {
							cancelled = true;
						}
					}),
					{ status: 200 }
				)
		);
		const error = await captureError(transportWith(fetchMock).complete(request()));

		expect(error).toMatchObject({ errorClass: 'response_too_large', retryable: false });
		expect(error.message).toBe('response_too_large (HTTP 200)');
		expect(cancelled).toBe(true);
		// 2 MB / 256 KB = 8 chunks fit; the 9th passes the cap (the stream may pull one ahead).
		expect(pulled).toBeLessThanOrEqual(MAX_RESPONSE_BYTES / chunk.byteLength + 2);
	});

	it('parses a body that arrives in chunks, split inside a multi-byte character', async () => {
		const bytes = new TextEncoder().encode(
			JSON.stringify({ choices: [{ message: { content: 'ข่าวสาร' } }] })
		);
		const fetchMock = vi.fn<typeof fetch>(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							// Thai characters are 3 bytes in UTF-8; split every 2 bytes.
							for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
							controller.close();
						}
					}),
					{ status: 200 }
				)
		);
		expect(await transportWith(fetchMock).complete(request())).toEqual({
			content: 'ข่าวสาร',
			tokens_in: null,
			tokens_out: null
		});
	});

	it('maps a network failure to a retryable network error', async () => {
		const failingFetch = vi.fn<typeof fetch>(async () => {
			throw new TypeError('fetch failed');
		});
		expect(await captureError(transportWith(failingFetch).complete(request()))).toMatchObject({
			errorClass: 'network',
			retryable: true
		});
	});
});

describe('parseRetryAfter', () => {
	it('parses delta-seconds and HTTP dates, and ignores junk', () => {
		const now = new Date('2026-11-13T00:00:00.000Z');
		expect(parseRetryAfter('3', now)).toBe(3000);
		expect(parseRetryAfter('Fri, 13 Nov 2026 00:00:10 GMT', now)).toBe(10_000);
		expect(parseRetryAfter('soon', now)).toBeNull();
		expect(parseRetryAfter(null, now)).toBeNull();
	});
});
