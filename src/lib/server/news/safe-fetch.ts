/**
 * SSRF-safe fetch (ARCHITECTURE §9, PRD §9.1). Every hop, including each redirect, must be:
 * https, an exact `host[:port]` from the allowlist (derived from enabled registry sources), free of
 * credentials, and resolve only to public IP addresses. The default transport re-checks the
 * address at connect time (no DNS-rebinding gap) and never follows redirects itself.
 * Timeout, body cap and content-type are enforced here; transport and DNS are injectable.
 *
 * Operational notes (documented, not handled):
 * - Proxies: with `HTTPS_PROXY` / `NODE_USE_ENV_PROXY` set, Node connects to the proxy, so the
 *   connect-time check sees the proxy's address, not the feed's. The pre-flight DNS check still
 *   runs, but the rebinding guard is gone. Do not set a proxy env for the app/job container.
 * - NAT64: all of `64:ff9b::/96` (and `64:ff9b:1::/48`) is blocked. On an IPv6-only host behind
 *   DNS64 every feed resolves into that range, so every fetch fails closed (`not_allowed`).
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup as dnsLookupAsync } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import type { SafeFetch, SourceDefinition } from '#lib/types/news.js';
import { NewsFetchError } from './errors.js';

export const SAFE_FETCH_DEFAULTS = {
	timeoutMs: 15_000,
	maxBodyBytes: 5 * 1024 * 1024,
	maxRedirects: 3
} as const;
/** Generic on purpose: no contact details or personal info (PRD §9.1). */
export const USER_AGENT = 'WorldviewBot/0.1';

const FEED_CONTENT_TYPES = new Set([
	'application/rss+xml',
	'application/atom+xml',
	'application/rdf+xml',
	'application/xml',
	'text/xml',
	'application/x-rss+xml'
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Answers without a body: returned as an empty `Response`, never parsed. */
export const NO_BODY_STATUSES = new Set([204, 205, 304]);
/** Error code of the connect-time address check in the default transport. */
const CONNECT_BLOCKED_CODE = 'EADDRNOTALLOWED';

/** Performs exactly one request. Must not follow redirects or decompress (SafeFetch inflates gzip itself, capped). */
export type HttpTransport = (
	url: URL,
	init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<Response>;

export type ResolveHost = (hostname: string) => Promise<string[]>;

export interface SafeFetchOptions {
	/** Exact `URL.host` values (host, plus port when not 443). */
	allowedHosts: readonly string[];
	transport?: HttpTransport;
	resolveHost?: ResolveHost;
	timeoutMs?: number;
	maxBodyBytes?: number;
	maxRedirects?: number;
}

export function createSafeFetch(options: SafeFetchOptions): SafeFetch {
	const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
	const transport = options.transport ?? nodeHttpsTransport;
	const resolveHost = options.resolveHost ?? resolveWithSystemDns;
	const timeoutMs = options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
	const maxBodyBytes = options.maxBodyBytes ?? SAFE_FETCH_DEFAULTS.maxBodyBytes;
	const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;

	return async function safeFetch(rawUrl, init = {}) {
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
		const headers: Record<string, string> = {
			...init.headers,
			'user-agent': USER_AGENT,
			'accept-encoding': 'identity'
		};

		try {
			let url = parseUrl(rawUrl);
			for (let redirects = 0; ; redirects++) {
				await assertAllowed(url, allowedHosts, resolveHost, signal);
				const response = await transport(url, { headers, signal });

				if (REDIRECT_STATUSES.has(response.status)) {
					await response.body?.cancel();
					if (redirects >= maxRedirects) throw notAllowed(`more than ${maxRedirects} redirects`);
					const location = response.headers.get('location');
					if (!location) throw httpError(response.status, 'redirect without Location', null);
					url = parseUrl(location, url);
					continue;
				}
				if (NO_BODY_STATUSES.has(response.status)) {
					await response.body?.cancel();
					return new Response(null, { status: response.status, headers: response.headers });
				}
				if (response.status < 200 || response.status > 299) {
					await response.body?.cancel();
					throw httpError(response.status, `HTTP ${response.status}`, response.headers);
				}

				assertFeedContentType(response);
				const raw = await readBodyCapped(response, maxBodyBytes, signal);
				const body = gunzipIfCompressed(raw, response.headers, maxBodyBytes);
				const responseHeaders = new Headers(response.headers);
				responseHeaders.delete('content-encoding');
				return new Response(body, { status: response.status, headers: responseHeaders });
			}
		} catch (error) {
			throw toNewsFetchError(error, {
				callerAborted: init.signal?.aborted === true,
				timeoutSignal
			});
		}
	};
}

/** Hosts of enabled `rss` sources whose feed URL is https: the SafeFetch allowlist. */
export function allowedHostsFromRegistry(definitions: readonly SourceDefinition[]): string[] {
	const hosts = definitions
		.filter((definition) => definition.enabled && definition.kind === 'rss')
		.flatMap((definition) => {
			const url = URL.parse(definition.feed_url);
			return url?.protocol === 'https:' ? [url.host] : [];
		});
	return [...new Set(hosts)];
}

/** True for loopback, private, link-local, CGNAT, multicast, documentation and other non-public ranges. */
export function isBlockedAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return true;
	return BLOCKED_RANGES.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const BLOCKED_RANGES = buildBlockedRanges();

function buildBlockedRanges(): BlockList {
	const list = new BlockList();
	const ipv4: [string, number][] = [
		['0.0.0.0', 8],
		['10.0.0.0', 8],
		['100.64.0.0', 10],
		['127.0.0.0', 8],
		['169.254.0.0', 16],
		['172.16.0.0', 12],
		['192.0.0.0', 24],
		['192.0.2.0', 24],
		['192.88.99.0', 24],
		['192.168.0.0', 16],
		['198.18.0.0', 15],
		['198.51.100.0', 24],
		['203.0.113.0', 24],
		['224.0.0.0', 4],
		['240.0.0.0', 4]
	];
	const ipv6: [string, number][] = [
		// ::/96 = unspecified, loopback and deprecated IPv4-compatible (`::127.0.0.1`).
		['::', 96],
		['::1', 128],
		['64:ff9b::', 96],
		['64:ff9b:1::', 48],
		['100::', 64],
		['2001::', 23],
		['2001:db8::', 32],
		['2002::', 16],
		['fc00::', 7],
		['fe80::', 10],
		['fec0::', 10],
		['ff00::', 8]
	];
	for (const [network, prefix] of ipv4) list.addSubnet(network, prefix, 'ipv4');
	// IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is matched against the IPv4 rules by BlockList itself.
	for (const [network, prefix] of ipv6) list.addSubnet(network, prefix, 'ipv6');
	return list;
}

function parseUrl(raw: string, base?: URL): URL {
	try {
		return new URL(raw, base);
	} catch {
		throw notAllowed('invalid URL');
	}
}

async function assertAllowed(
	url: URL,
	allowedHosts: Set<string>,
	resolveHost: ResolveHost,
	signal: AbortSignal
): Promise<void> {
	if (url.protocol !== 'https:') throw notAllowed('only https is allowed');
	if (url.username || url.password) throw notAllowed('credentials in URL are not allowed');
	if (!allowedHosts.has(url.host)) throw notAllowed(`host ${url.host} is not in the allowlist`);

	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(hostname) ? [hostname] : await raceAbort(resolveHost(hostname), signal);
	if (addresses.length === 0) throw notAllowed(`host ${url.host} did not resolve`);
	if (addresses.some(isBlockedAddress)) {
		throw notAllowed(`host ${url.host} resolves to a non-public address`);
	}
}

/** getaddrinfo cannot be cancelled, so a slow resolver is raced against the timeout instead. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

function assertFeedContentType(response: Response): void {
	const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
	if (!mediaType || !FEED_CONTENT_TYPES.has(mediaType)) {
		throw notAllowed(`unexpected content-type ${mediaType ?? '(none)'}`);
	}
}

async function readBodyCapped(
	response: Response,
	maxBodyBytes: number,
	signal: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBodyBytes) {
		await response.body?.cancel();
		throw tooLarge(maxBodyBytes);
	}
	if (!response.body) return new Uint8Array();

	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = response.body.getReader();
	// A body that stalls after the headers must still hit the timeout.
	const cancelOnAbort = () => void reader.cancel().catch(() => undefined);
	signal.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		for (;;) {
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			total += value.byteLength;
			if (total > maxBodyBytes) {
				await reader.cancel();
				throw tooLarge(maxBodyBytes);
			}
			chunks.push(value);
		}
	} finally {
		signal.removeEventListener('abort', cancelOnAbort);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function toNewsFetchError(
	error: unknown,
	context: { callerAborted: boolean; timeoutSignal: AbortSignal }
): NewsFetchError {
	if (error instanceof NewsFetchError) return error;
	if (context.callerAborted) {
		return new NewsFetchError({
			kind: 'network',
			retryable: false,
			status: null,
			message: 'aborted'
		});
	}
	if (context.timeoutSignal.aborted) {
		return new NewsFetchError({
			kind: 'timeout',
			retryable: true,
			status: null,
			message: 'timed out'
		});
	}
	// Transport errors (DNS, TLS, reset). `code` is safe to log; the raw message may not be.
	const code = (error as { code?: unknown })?.code;
	if (code === CONNECT_BLOCKED_CODE) {
		return notAllowed('connection to a non-public address refused');
	}
	return new NewsFetchError({
		kind: 'network',
		retryable: true,
		status: null,
		message: typeof code === 'string' ? `network error ${code}` : 'network error'
	});
}

/**
 * Some servers (UN News) send gzip even though we ask for `identity`. The compressed body was
 * already capped, and inflation is capped at the same limit, so a decompression bomb fails as
 * `too_large`. Detected by the header or the gzip magic bytes (XML never starts with 0x1f).
 */
function gunzipIfCompressed(
	body: Uint8Array<ArrayBuffer>,
	headers: Headers,
	maxBodyBytes: number
): Uint8Array<ArrayBuffer> {
	const encoding = headers.get('content-encoding')?.trim().toLowerCase() ?? 'identity';
	const isGzip = encoding === 'gzip' || encoding === 'x-gzip';
	if (!isGzip && encoding !== 'identity') {
		throw new NewsFetchError({
			kind: 'parse_error',
			retryable: false,
			status: null,
			message: `unsupported content-encoding ${encoding.slice(0, 20)}`
		});
	}
	const hasGzipMagic = body[0] === 0x1f && body[1] === 0x8b;
	if (!isGzip && !hasGzipMagic) return body;
	try {
		return new Uint8Array(gunzipSync(body, { maxOutputLength: maxBodyBytes }));
	} catch (error) {
		if (error instanceof RangeError) throw tooLarge(maxBodyBytes);
		throw new NewsFetchError({
			kind: 'parse_error',
			retryable: false,
			status: null,
			message: 'invalid gzip body'
		});
	}
}

function notAllowed(message: string): NewsFetchError {
	return new NewsFetchError({ kind: 'not_allowed', retryable: false, status: null, message });
}

function tooLarge(maxBodyBytes: number): NewsFetchError {
	return new NewsFetchError({
		kind: 'too_large',
		retryable: false,
		status: null,
		message: `body larger than ${maxBodyBytes} bytes`
	});
}

function httpError(status: number, message: string, headers: Headers | null): NewsFetchError {
	const retryable = status === 408 || status === 429 || status >= 500;
	return new NewsFetchError({
		kind: 'http_error',
		retryable,
		status,
		message,
		retry_after_ms: retryable ? parseRetryAfterMs(headers?.get('retry-after') ?? null) : null
	});
}

/** `Retry-After` as delta-seconds or an HTTP date; null when absent or unparseable. */
function parseRetryAfterMs(value: string | null): number | null {
	if (!value) return null;
	if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
	const at = Date.parse(value);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

async function resolveWithSystemDns(hostname: string): Promise<string[]> {
	const results = await dnsLookupAsync(hostname, { all: true, verbatim: true });
	return results.map((result) => result.address);
}

/**
 * Default transport: one `node:https` GET. Its `lookup` rejects non-public addresses at connect
 * time, so a DNS answer that changes after `assertAllowed` cannot reach an internal host.
 */
const nodeHttpsTransport: HttpTransport = (url, { headers, signal }) =>
	new Promise((resolve, reject) => {
		const request = httpsRequest(
			url,
			{ method: 'GET', headers, signal, lookup: publicOnlyLookup },
			(incoming) => {
				const status = incoming.statusCode ?? 0;
				if (status < 200 || status > 599) {
					incoming.destroy();
					reject(new Error('invalid HTTP status'));
					return;
				}
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(incoming.headers)) {
					for (const item of Array.isArray(value) ? value : value ? [value] : []) {
						responseHeaders.append(name, item);
					}
				}
				const hasNoBody = NO_BODY_STATUSES.has(status);
				if (hasNoBody) incoming.destroy();
				const body = hasNoBody ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
				resolve(new Response(body, { status, headers: responseHeaders }));
			}
		);
		request.on('error', reject);
		request.end();
	});

type LookupCallback = (
	error: NodeJS.ErrnoException | null,
	address: string | LookupAddress[],
	family?: number
) => void;

function publicOnlyLookup(hostname: string, options: object, callback: LookupCallback): void {
	dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, []);
		const blocked = addresses.some((entry) => isBlockedAddress(entry.address));
		if (blocked || addresses.length === 0) {
			const refused = Object.assign(new Error('address not allowed'), {
				code: CONNECT_BLOCKED_CODE
			});
			return callback(refused, []);
		}
		if ((options as { all?: boolean }).all) return callback(null, addresses);
		const first = addresses[0]!;
		callback(null, first.address, first.family);
	});
}
