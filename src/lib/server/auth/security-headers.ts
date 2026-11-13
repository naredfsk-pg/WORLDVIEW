/**
 * Security headers for every response that passes through `handle` (ARCHITECTURE §4,
 * "Security headers & CSP").
 *
 * CSP: rendered pages already carry SvelteKit's policy (`csp` in vite.config.ts, hash mode, with
 * this page's hydration-script hash), which is kept. Every other response gets `FALLBACK_CSP`,
 * the same directives without per-page hashes.
 *
 * HTTPS-only extras (HSTS, `upgrade-insecure-requests`) are added when `isHttpsRequest` says the
 * visitor used HTTPS. Browsers ignore HSTS received over plain HTTP, so a wrong "yes" is harmless.
 */
import { FALLBACK_CSP } from './csp.js';

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-resource-policy': 'same-origin'
};

/** 180 days, this host only, no `preload` (that list is hard to leave). */
const HTTPS_HEADERS: Record<string, string> = {
	'strict-transport-security': 'max-age=15552000'
};

const ADMIN_HEADERS: Record<string, string> = {
	'cache-control': 'private, no-store',
	'x-robots-tag': 'noindex, nofollow'
};

export function withSecurityHeaders(
	response: Response,
	options: { admin: boolean; https: boolean }
): Response {
	const headers = {
		...SECURITY_HEADERS,
		...(options.https ? HTTPS_HEADERS : {}),
		...(options.admin ? ADMIN_HEADERS : {}),
		...htmlCharset(response),
		'content-security-policy': contentSecurityPolicy(response, options.https)
	};
	try {
		for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
		return response;
	} catch {
		// Responses passed through from `fetch` have immutable headers: copy them.
		const copy = new Response(response.body, response);
		for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
		return copy;
	}
}

/**
 * Cloudflare terminates TLS and cloudflared reaches the app over plain HTTP, so the socket says
 * nothing. The visitor's scheme comes from `X-Forwarded-Proto` (set by Cloudflare/cloudflared;
 * only cloudflared can reach the container), or from `event.url` when `ORIGIN` is an https URL.
 */
export function isHttpsRequest(event: { url: URL; request: Request }): boolean {
	if (event.url.protocol === 'https:') return true;
	const forwarded = event.request.headers.get('x-forwarded-proto')?.split(',')[0] ?? '';
	return forwarded.trim().toLowerCase() === 'https';
}

/**
 * SvelteKit sends pages as bare `text/html`. Browsers still decode UTF-8 from `<meta charset>`,
 * but clients that only read the header (PowerShell 5.1, some proxies and log tools) fall back to
 * ISO-8859-1 and garble every Thai character (BUG-QA-007), so the charset is stated.
 */
function htmlCharset(response: Response): Record<string, string> {
	return response.headers.get('content-type') === 'text/html'
		? { 'content-type': 'text/html; charset=utf-8' }
		: {};
}

/** Keep SvelteKit's page policy, else the fallback; `upgrade-insecure-requests` only over HTTPS. */
function contentSecurityPolicy(response: Response, https: boolean): string {
	const policy = response.headers.get('content-security-policy') ?? FALLBACK_CSP;
	return https ? `${policy}; upgrade-insecure-requests` : policy;
}
