import { describe, expect, it } from 'vitest';
import type { SourceDefinition } from '#lib/types/news.js';
import { NewsFetchError } from './errors';
import {
	allowedHostsFromRegistry,
	createSafeFetch,
	isBlockedAddress,
	USER_AGENT,
	type HttpTransport
} from './safe-fetch';

const FEED_HEADERS = { 'content-type': 'application/rss+xml; charset=utf-8' };
const PUBLIC_IP = '93.184.215.14';

/** Fake DNS: every name resolves to a public address unless listed. */
const fakeDns =
	(overrides: Record<string, string[]> = {}) =>
	async (hostname: string) =>
		overrides[hostname] ?? [PUBLIC_IP];

type Call = { url: string; headers: Record<string, string> };

/** Fake transport keyed by URL; records every request so tests can assert nothing else was hit. */
function fakeTransport(routes: Record<string, () => Response | Promise<Response>>) {
	const calls: Call[] = [];
	const transport: HttpTransport = async (url, init) => {
		calls.push({ url: url.href, headers: init.headers });
		const route = routes[url.href];
		if (!route) throw new Error(`unexpected request to ${url.href}`);
		return route();
	};
	return { transport, calls };
}

async function expectFetchError(promise: Promise<unknown>, expected: Partial<NewsFetchError>) {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught
	);
	expect(error).toBeInstanceOf(NewsFetchError);
	expect(error).toMatchObject(expected);
}

describe('createSafeFetch', () => {
	it('fetches an allowlisted https feed with a generic User-Agent', async () => {
		const { transport, calls } = fakeTransport({
			'https://feeds.example.com/rss.xml': () =>
				new Response('<rss/>', { status: 200, headers: FEED_HEADERS })
		});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});

		const response = await safeFetch('https://feeds.example.com/rss.xml', {
			headers: { accept: 'application/rss+xml', 'user-agent': 'spoofed' }
		});
		expect(await response.text()).toBe('<rss/>');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.headers['user-agent']).toBe(USER_AGENT);
		expect(calls[0]!.headers['accept']).toBe('application/rss+xml');
		expect(USER_AGENT).toBe('WorldviewBot/0.1');
	});

	it('blocks a host that is not in the allowlist, before any request', async () => {
		const { transport, calls } = fakeTransport({});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch('https://evil.example.net/rss.xml'), {
			kind: 'not_allowed',
			retryable: false
		});
		// A suffix or a different port is a different host.
		await expectFetchError(safeFetch('https://feeds.example.com.evil.net/rss.xml'), {
			kind: 'not_allowed'
		});
		await expectFetchError(safeFetch('https://feeds.example.com:8443/rss.xml'), {
			kind: 'not_allowed'
		});
		expect(calls).toHaveLength(0);
	});

	it('allows https only', async () => {
		const { transport, calls } = fakeTransport({});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch('http://feeds.example.com/rss.xml'), {
			kind: 'not_allowed'
		});
		await expectFetchError(safeFetch('file:///etc/passwd'), { kind: 'not_allowed' });
		expect(calls).toHaveLength(0);
	});

	it('blocks an allowlisted host that resolves to a private IP', async () => {
		const { transport, calls } = fakeTransport({});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns({ 'feeds.example.com': [PUBLIC_IP, '10.0.0.5'] })
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
			kind: 'not_allowed',
			message: expect.stringContaining('non-public address')
		});
		expect(calls).toHaveLength(0);
	});

	it('blocks IP-literal hosts in private ranges even when allowlisted', async () => {
		const { transport, calls } = fakeTransport({});
		const safeFetch = createSafeFetch({
			allowedHosts: ['127.0.0.1', '[::1]', '169.254.169.254'],
			transport,
			resolveHost: fakeDns()
		});
		for (const url of [
			'https://127.0.0.1/feed',
			'https://[::1]/feed',
			'https://169.254.169.254/latest/meta-data'
		]) {
			await expectFetchError(safeFetch(url), { kind: 'not_allowed' });
		}
		expect(calls).toHaveLength(0);
	});

	it('re-checks every redirect hop: a redirect to a private IP is blocked', async () => {
		const { transport, calls } = fakeTransport({
			'https://feeds.example.com/rss.xml': () =>
				new Response(null, {
					status: 302,
					headers: { location: 'https://cdn.example.com/rss.xml' }
				})
		});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com', 'cdn.example.com'],
			transport,
			resolveHost: fakeDns({ 'cdn.example.com': ['192.168.1.20'] })
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
			kind: 'not_allowed',
			message: expect.stringContaining('cdn.example.com')
		});
		expect(calls.map((call) => call.url)).toEqual(['https://feeds.example.com/rss.xml']);
	});

	it('blocks a redirect to a host outside the allowlist or to http', async () => {
		for (const location of [
			'https://elsewhere.example.org/rss.xml',
			'http://feeds.example.com/rss.xml'
		]) {
			const { transport, calls } = fakeTransport({
				'https://feeds.example.com/rss.xml': () =>
					new Response(null, { status: 301, headers: { location } })
			});
			const safeFetch = createSafeFetch({
				allowedHosts: ['feeds.example.com'],
				transport,
				resolveHost: fakeDns()
			});
			await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
				kind: 'not_allowed'
			});
			expect(calls).toHaveLength(1);
		}
	});

	it('follows up to 3 allowlisted redirects (relative Location too), then refuses the 4th', async () => {
		const hop = (to: string) => () =>
			new Response(null, { status: 307, headers: { location: to } });
		const ok = () => new Response('<rss/>', { status: 200, headers: FEED_HEADERS });
		const base = 'https://feeds.example.com';

		const three = fakeTransport({
			[`${base}/0`]: hop('/1'),
			[`${base}/1`]: hop(`${base}/2`),
			[`${base}/2`]: hop('3'),
			[`${base}/3`]: ok
		});
		const safeFetch3 = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport: three.transport,
			resolveHost: fakeDns()
		});
		expect((await safeFetch3(`${base}/0`)).status).toBe(200);
		expect(three.calls).toHaveLength(4);

		const four = fakeTransport({
			[`${base}/0`]: hop('/1'),
			[`${base}/1`]: hop('/2'),
			[`${base}/2`]: hop('/3'),
			[`${base}/3`]: hop('/4'),
			[`${base}/4`]: ok
		});
		const safeFetch4 = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport: four.transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch4(`${base}/0`), {
			kind: 'not_allowed',
			message: 'more than 3 redirects'
		});
		expect(four.calls).toHaveLength(4);
	});

	it('rejects an oversized body, by Content-Length and while streaming', async () => {
		const declared = fakeTransport({
			'https://feeds.example.com/rss.xml': () =>
				new Response('x', { status: 200, headers: { ...FEED_HEADERS, 'content-length': '999999' } })
		});
		const streamed = fakeTransport({
			'https://feeds.example.com/rss.xml': () =>
				new Response('x'.repeat(2048), { status: 200, headers: FEED_HEADERS })
		});
		for (const { transport } of [declared, streamed]) {
			const safeFetch = createSafeFetch({
				allowedHosts: ['feeds.example.com'],
				transport,
				resolveHost: fakeDns(),
				maxBodyBytes: 1024
			});
			await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
				kind: 'too_large',
				retryable: false
			});
		}
	});

	it('times out a request that never answers (retryable)', async () => {
		const transport: HttpTransport = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
			});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns(),
			timeoutMs: 20
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
			kind: 'timeout',
			retryable: true
		});
	});

	it('times out a DNS lookup that never answers, without any request', async () => {
		const { transport, calls } = fakeTransport({});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: () => new Promise(() => {}),
			timeoutMs: 20
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), { kind: 'timeout' });
		expect(calls).toHaveLength(0);
	});

	it('times out a body that stalls after the headers', async () => {
		const stalled = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('<rss>'));
			}
		});
		const { transport } = fakeTransport({
			'https://feeds.example.com/rss.xml': () =>
				new Response(stalled, { status: 200, headers: FEED_HEADERS })
		});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns(),
			timeoutMs: 20
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), { kind: 'timeout' });
	});

	it('reports a caller abort as non-retryable', async () => {
		const transport: HttpTransport = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
			});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		const controller = new AbortController();
		const pending = safeFetch('https://feeds.example.com/rss.xml', { signal: controller.signal });
		controller.abort();
		await expectFetchError(pending, { kind: 'network', retryable: false });
	});

	it('maps the connect-time address refusal to a non-retryable not_allowed', async () => {
		const transport: HttpTransport = async () => {
			throw Object.assign(new Error('address not allowed'), { code: 'EADDRNOTALLOWED' });
		};
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
			kind: 'not_allowed',
			retryable: false
		});
	});

	it.each([204, 205, 304])(
		'returns an empty response for HTTP %i without throwing',
		async (status) => {
			const { transport } = fakeTransport({
				'https://feeds.example.com/rss.xml': () => new Response(null, { status })
			});
			const safeFetch = createSafeFetch({
				allowedHosts: ['feeds.example.com'],
				transport,
				resolveHost: fakeDns()
			});
			const response = await safeFetch('https://feeds.example.com/rss.xml');
			expect(response.status).toBe(status);
			expect(await response.text()).toBe('');
		}
	);

	it('rejects unexpected content types', async () => {
		const { transport } = fakeTransport({
			'https://feeds.example.com/rss.xml': () =>
				new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } })
		});
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
			kind: 'not_allowed',
			message: 'unexpected content-type text/html'
		});
	});

	it('classifies HTTP errors: 5xx/429 retryable with Retry-After, other 4xx not', async () => {
		const statuses: Record<string, () => Response> = {
			'https://feeds.example.com/503': () =>
				new Response('down', { status: 503, headers: { 'retry-after': '7' } }),
			'https://feeds.example.com/429': () => new Response('slow down', { status: 429 }),
			'https://feeds.example.com/404': () => new Response('missing', { status: 404 })
		};
		const { transport } = fakeTransport(statuses);
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch('https://feeds.example.com/503'), {
			kind: 'http_error',
			status: 503,
			retryable: true,
			retry_after_ms: 7000
		});
		await expectFetchError(safeFetch('https://feeds.example.com/429'), {
			status: 429,
			retryable: true
		});
		await expectFetchError(safeFetch('https://feeds.example.com/404'), {
			status: 404,
			retryable: false,
			message: 'HTTP 404'
		});
	});

	it('maps transport failures to retryable network errors without leaking the raw message', async () => {
		const transport: HttpTransport = async () => {
			throw Object.assign(new Error('getaddrinfo ENOTFOUND internal-secret-host'), {
				code: 'ENOTFOUND'
			});
		};
		const safeFetch = createSafeFetch({
			allowedHosts: ['feeds.example.com'],
			transport,
			resolveHost: fakeDns()
		});
		await expectFetchError(safeFetch('https://feeds.example.com/rss.xml'), {
			kind: 'network',
			retryable: true,
			message: 'network error ENOTFOUND'
		});
	});
});

describe('isBlockedAddress', () => {
	it.each([
		'127.0.0.1',
		'10.1.2.3',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'224.0.0.1',
		'255.255.255.255',
		'::1',
		'::',
		'fe80::1',
		'fc00::1',
		'fd12:3456::1',
		'::ffff:127.0.0.1',
		'::ffff:10.0.0.1',
		'64:ff9b::a00:1',
		'::7f00:1',
		'::127.0.0.1',
		'not-an-ip'
	])('blocks %s', (address) => {
		expect(isBlockedAddress(address)).toBe(true);
	});

	it.each(['8.8.8.8', '93.184.215.14', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
		'allows public %s',
		(address) => {
			expect(isBlockedAddress(address)).toBe(false);
		}
	);
});

describe('allowedHostsFromRegistry', () => {
	const source = (overrides: Partial<SourceDefinition>): SourceDefinition => ({
		id: 'x',
		name: 'X',
		kind: 'rss',
		homepage_url: 'https://x.example',
		feed_url: 'https://feeds.x.example/rss.xml',
		license_notes: 'test',
		allow_excerpt: false,
		is_demo: false,
		enabled: true,
		...overrides
	});

	it('takes exact hosts from enabled https rss sources only', () => {
		expect(
			allowedHostsFromRegistry([
				source({}),
				source({ id: 'dup', feed_url: 'https://FEEDS.x.example/other.xml' }),
				source({ id: 'port', feed_url: 'https://y.example:8443/rss' }),
				source({ id: 'off', feed_url: 'https://disabled.example/rss', enabled: false }),
				source({ id: 'http', feed_url: 'http://plain.example/rss' }),
				source({ id: 'fx', kind: 'fixture', feed_url: 'tests/fixtures/feeds/wire-a.xml' })
			])
		).toEqual(['feeds.x.example', 'y.example:8443']);
	});
});
