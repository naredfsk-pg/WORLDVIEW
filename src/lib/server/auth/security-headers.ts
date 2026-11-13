/**
 * Security headers for every response (ARCHITECTURE §4).
 *
 * The CSP has no `script-src`/`style-src` on purpose: SvelteKit's per-page inline hydration
 * script and the no-flash theme script in `app.html` would need `kit.csp` (hash mode) configured
 * in the SvelteKit config. These directives do not touch scripts or styles, so they cannot break
 * the page.
 */
const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'content-security-policy':
		"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
};

const ADMIN_HEADERS: Record<string, string> = {
	'cache-control': 'private, no-store',
	'x-robots-tag': 'noindex, nofollow'
};

export function withSecurityHeaders(response: Response, options: { admin: boolean }): Response {
	const headers = { ...SECURITY_HEADERS, ...(options.admin ? ADMIN_HEADERS : {}) };
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
