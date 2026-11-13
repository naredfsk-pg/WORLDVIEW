/**
 * Server hooks (ARCHITECTURE §3, §4):
 * - `/admin*` (GET, form POSTs and `__data.json`) goes through the Cloudflare Access gate.
 * - Every response gets the security headers (pages keep SvelteKit's hash-mode CSP, the rest get
 *   the fallback CSP; HSTS only over HTTPS); admin responses also get `no-store`.
 * - `handleError` logs an error id plus a sanitized message and returns only a Thai message.
 *
 * CSRF stays with SvelteKit's built-in origin check for form actions (it runs before `handle`
 * and relies on `ORIGIN` in production).
 */
import { randomUUID } from 'node:crypto';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { createAdminGuard, isAdminRequest } from '#lib/server/auth/admin-guard.js';
import { ADMIN_ACTION_RATE_LIMIT, createTokenBucketLimiter } from '#lib/server/auth/rate-limit.js';
import { isHttpsRequest, withSecurityHeaders } from '#lib/server/auth/security-headers.js';
import { getConfig } from '#lib/server/config.js';
import { sanitizeErrorMessage } from '#lib/server/errors.js';

const MAX_LOGGED_MESSAGE_LENGTH = 200;

const adminGuard = createAdminGuard({
	getConfig,
	// Vite replaces `import.meta.env.DEV` with `false` in `vite build`, so the dev identity and
	// the bypass it enables are not part of a production build at all.
	devBypassIdentity: import.meta.env.DEV ? { email: 'dev@localhost' } : null,
	// Raw, with no default: the bypass needs NODE_ENV to be set to exactly `development`.
	readNodeEnv: () => process.env.NODE_ENV,
	limiter: createTokenBucketLimiter(ADMIN_ACTION_RATE_LIMIT)
});

export const handle: Handle = async ({ event, resolve }) => {
	const admin = isAdminRequest(event);
	const response = admin ? await adminGuard({ event, resolve }) : await resolve(event);
	return withSecurityHeaders(response, { admin, https: isHttpsRequest(event) });
};

export const handleError: HandleServerError = ({ kind, error, event }) => {
	// `error(...)` from loads already carries a Thai message; keep it.
	if (kind === 'app') return;
	if (kind !== 'unknown') {
		// Framework errors (404 no route, 405, 415, …): status kept, message translated.
		return {
			message: error.status === 404 ? 'ไม่พบหน้าที่คุณต้องการ' : 'คำขอไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
		};
	}

	const errorId = randomUUID();
	console.error(
		'[error]',
		JSON.stringify({
			error_id: errorId,
			path: event.url.pathname,
			message: sanitizeErrorMessage(error, MAX_LOGGED_MESSAGE_LENGTH)
		})
	);
	return {
		message: `เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง (รหัสอ้างอิง ${errorId})`,
		error_id: errorId
	};
};
