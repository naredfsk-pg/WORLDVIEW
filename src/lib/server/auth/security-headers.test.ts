import { describe, expect, it } from 'vitest';
import { FALLBACK_CSP } from './csp';
import { isHttpsRequest, withSecurityHeaders } from './security-headers';

const PLAIN_HTTP = { admin: false, https: false };

describe('withSecurityHeaders', () => {
	it('sets the baseline headers on every response', () => {
		const response = withSecurityHeaders(new Response('ok'), PLAIN_HTTP);

		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('permissions-policy')).toContain('camera=()');
		expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
		expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
		expect(response.headers.get('content-security-policy')).toBe(FALLBACK_CSP);
		expect(response.headers.get('strict-transport-security')).toBeNull();
		expect(response.headers.get('cache-control')).toBeNull();
	});

	it("keeps the policy SvelteKit set on a rendered page (it holds that page's script hashes)", () => {
		const pagePolicy = "default-src 'self'; script-src 'self' 'sha256-page'";
		const page = new Response('<html>', { headers: { 'content-security-policy': pagePolicy } });

		const response = withSecurityHeaders(page, PLAIN_HTTP);

		expect(response.headers.get('content-security-policy')).toBe(pagePolicy);
	});

	it('adds HSTS and upgrade-insecure-requests only over HTTPS', () => {
		const response = withSecurityHeaders(new Response('ok'), { admin: false, https: true });

		expect(response.headers.get('strict-transport-security')).toBe('max-age=15552000');
		expect(response.headers.get('content-security-policy')).toBe(
			`${FALLBACK_CSP}; upgrade-insecure-requests`
		);
	});

	it('marks admin responses no-store, overriding a public cache header', () => {
		const page = new Response('admin', { headers: { 'cache-control': 'public, max-age=60' } });
		const response = withSecurityHeaders(page, { admin: true, https: false });

		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-robots-tag')).toContain('noindex');
	});

	it('states charset=utf-8 on bare text/html, and leaves other content types alone', () => {
		const page = new Response('<html>ข่าว', { headers: { 'content-type': 'text/html' } });
		expect(withSecurityHeaders(page, PLAIN_HTTP).headers.get('content-type')).toBe(
			'text/html; charset=utf-8'
		);

		const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
		expect(withSecurityHeaders(json, PLAIN_HTTP).headers.get('content-type')).toBe(
			'application/json'
		);
	});

	it('copies responses whose headers are immutable', () => {
		const redirect = Response.redirect('http://localhost/admin', 303);
		const response = withSecurityHeaders(redirect, { admin: true, https: false });

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('http://localhost/admin');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('content-security-policy')).toBe(FALLBACK_CSP);
	});
});

describe('isHttpsRequest', () => {
	const event = (url: string, forwardedProto?: string) => ({
		url: new URL(url),
		request: new Request(url, {
			headers: forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}
		})
	});

	it('trusts the scheme Cloudflare forwards (TLS ends at the edge)', () => {
		expect(isHttpsRequest(event('http://app:3000/', 'https'))).toBe(true);
		expect(isHttpsRequest(event('http://app:3000/', 'HTTPS, http'))).toBe(true);
	});

	it('trusts an https ORIGIN (event.url)', () => {
		expect(isHttpsRequest(event('https://worldview.nared-fu.com/'))).toBe(true);
	});

	it('is false for plain HTTP (local dev, preview, e2e)', () => {
		expect(isHttpsRequest(event('http://localhost:5273/'))).toBe(false);
		expect(isHttpsRequest(event('http://localhost:5273/', 'http'))).toBe(false);
		expect(isHttpsRequest(event('http://localhost:5273/', 'http, https'))).toBe(false);
	});
});
