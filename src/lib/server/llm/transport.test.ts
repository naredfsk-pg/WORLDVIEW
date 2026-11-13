import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../../types/llm';
import {
	chatCompletionsUrl,
	createOpenAiCompatibleTransport,
	LlmTransportError,
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

	it('leaves the temperature key out when the request has none', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(okBody));
		await transportWith(fetchMock).complete(request({ temperature: undefined }));

		const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
		expect('temperature' in body).toBe(false);
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
		[401, 'auth', 'http_error', false],
		[403, 'auth', 'http_error', false],
		[400, 'bad_request', 'http_error', false],
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
