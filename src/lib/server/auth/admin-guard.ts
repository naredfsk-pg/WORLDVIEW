/**
 * The `/admin*` gate used by `hooks.server.ts` (ARCHITECTURE §4): rate-limit POSTs per client
 * IP, verify Cloudflare Access, then set `locals.admin`. Fails closed: missing config, a missing
 * or bad token, or an email that is not allowed → 403; the key set cannot be loaded → 503.
 * Deny pages are Thai and carry no details.
 */
import { createHash } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import type { AdminIdentity } from '../../types/views';
import type { AppConfig } from '../config';
import {
	ACCESS_JWT_HEADER,
	createAccessVerifier,
	resolveAccessSettings,
	isLoopbackHost,
	type AccessDecision,
	type AccessSettings,
	type AccessVerifier
} from './cloudflare-access';
import type { RateLimiter } from './rate-limit';

export interface AdminGuardOptions {
	getConfig: () => AppConfig;
	/**
	 * The `vite dev` identity, or null. `hooks.server.ts` passes
	 * `import.meta.env.DEV ? { email: 'dev@localhost' } : null`, which a production build compiles
	 * to `null`. Even then it is used only when `CF_ACCESS_AUD` is unset, the raw NODE_ENV is
	 * exactly `development` and the request host is loopback.
	 */
	devBypassIdentity: AdminIdentity | null;
	/** The raw `process.env.NODE_ENV`, with no default (an unset value never enables the bypass). */
	readNodeEnv: () => string | undefined;
	limiter: RateLimiter;
}

type AdminAccess = AccessDecision & { devBypass?: boolean };

/**
 * Admin when the path OR the matched route is admin. The route id keeps the guard on even if a
 * future `reroute` hook or base path maps another URL onto an admin route.
 */
export function isAdminRequest(event: Pick<RequestEvent, 'url' | 'route'>): boolean {
	if (isAdminPath(event.url.pathname)) return true;
	// Route groups such as `/(staff)/admin` do not appear in the URL.
	const routeId = event.route.id?.replace(/\/\([^)]*\)/g, '') ?? null;
	return routeId === '/admin' || routeId?.startsWith('/admin/') === true;
}

/** Same decoding SvelteKit applies before route matching, so `/%61dmin` is still admin. */
export function isAdminPath(pathname: string): boolean {
	let decoded: string;
	try {
		decoded = pathname.split('%25').map(decodeURI).join('%25').toLowerCase();
	} catch {
		// Undecodable paths cannot be matched safely: treat them as admin (fail closed).
		return true;
	}
	return decoded === '/admin' || decoded.startsWith('/admin/');
}

export function createAdminGuard(options: AdminGuardOptions): Handle {
	// Config is cached for the whole process, so the settings and the verifier (with its JWKS
	// cache) are built once, on the first admin request.
	let access: { settings: AccessSettings; verify: AccessVerifier } | null | undefined;

	return async ({ event, resolve }) => {
		if (event.request.method === 'POST') {
			const limit = options.limiter.take(clientAddress(event));
			if (!limit.allowed) {
				return denyPage(429, { 'retry-after': String(limit.retryAfterSeconds) });
			}
		}

		const decision = await authenticate(event);
		if (!decision.ok) {
			// Reason and path only: never the token or the claimed email.
			console.warn('[admin-auth] denied', {
				status: decision.status,
				reason: decision.reason,
				path: event.url.pathname
			});
			return denyPage(decision.status);
		}

		event.locals.admin = decision.admin;
		event.locals.adminDevBypass = decision.devBypass === true;
		return resolve(event);
	};

	async function authenticate(event: RequestEvent): Promise<AdminAccess> {
		const config = options.getConfig();
		if (access === undefined) {
			const settings = resolveAccessSettings(config);
			access = settings ? { settings, verify: createAccessVerifier(settings) } : null;
		}
		if (access) return access.verify(event.request.headers.get(ACCESS_JWT_HEADER));

		const bypass = options.devBypassIdentity;
		const bypassAllowed =
			bypass !== null &&
			options.readNodeEnv() === 'development' &&
			!config.cloudflare.accessAud &&
			isLoopbackHost(event.url.hostname);
		if (bypassAllowed) return { ok: true, admin: bypass, devBypass: true };
		return { ok: false, status: 403, reason: 'missing_config' };
	}
}

function clientAddress(event: RequestEvent): string {
	try {
		return event.getClientAddress();
	} catch {
		// adapter-node throws when ADDRESS_HEADER is configured but absent: share one bucket.
		return 'unknown';
	}
}

const DENY_COPY: Record<403 | 429 | 503, { title: string; body: string }> = {
	403: {
		title: 'ไม่มีสิทธิ์เข้าถึง',
		body: 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น'
	},
	429: {
		title: 'ส่งคำขอถี่เกินไป',
		body: 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'
	},
	503: {
		title: 'ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว',
		body: 'กรุณาลองใหม่อีกครั้งในอีกสักครู่'
	}
};

const DENY_PAGE_STYLE =
	"body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px 18px;font-family:'Noto Sans Thai',Tahoma,system-ui,sans-serif;background:#f7f8f5;color:#172622}main{max-width:480px}h1{font-size:24px;margin:0 0 8px}p{color:#5c6b65;margin:0 0 16px}a{color:#176653;font-weight:700}";

/** The deny page's own CSP: nothing but its inline style (`withSecurityHeaders` keeps it). */
const DENY_PAGE_CSP = [
	"default-src 'none'",
	`style-src 'sha256-${createHash('sha256').update(DENY_PAGE_STYLE).digest('base64')}'`,
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'"
].join('; ');

function denyPage(status: 403 | 429 | 503, extraHeaders: Record<string, string> = {}): Response {
	const { title, body } = DENY_COPY[status];
	const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${status} · ${title} · Worldview</title>
<style>${DENY_PAGE_STYLE}</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p><a href="/">กลับหน้าแรก</a></main></body>
</html>`;
	return new Response(html, {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': DENY_PAGE_CSP,
			...extraHeaders
		}
	});
}
