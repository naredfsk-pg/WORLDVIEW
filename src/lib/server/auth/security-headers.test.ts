import { describe, expect, it } from 'vitest';
import { withSecurityHeaders } from './security-headers';

describe('withSecurityHeaders', () => {
	it('sets the baseline headers on every response', () => {
		const response = withSecurityHeaders(new Response('ok'), { admin: false });

		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('permissions-policy')).toContain('camera=()');
		const csp = response.headers.get('content-security-policy') ?? '';
		expect(csp).toContain("frame-ancestors 'none'");
		// No script-src: it would block SvelteKit's inline hydration and the app.html theme script.
		expect(csp).not.toContain('script-src');
		expect(response.headers.get('cache-control')).toBeNull();
	});

	it('marks admin responses no-store, overriding a public cache header', () => {
		const page = new Response('admin', { headers: { 'cache-control': 'public, max-age=60' } });
		const response = withSecurityHeaders(page, { admin: true });

		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-robots-tag')).toContain('noindex');
	});

	it('copies responses whose headers are immutable', () => {
		const redirect = Response.redirect('http://localhost/admin', 303);
		const response = withSecurityHeaders(redirect, { admin: true });

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('http://localhost/admin');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
});
