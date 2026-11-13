/**
 * Server hooks (ARCHITECTURE §3, §4):
 * - `/admin*` (GET, form POSTs and `__data.json`) goes through the Cloudflare Access gate.
 * - Every response gets the security headers; admin responses also get `no-store`.
 * - `handleError` logs an error id plus a sanitized message and returns only a Thai message.
 *
 * CSRF stays with SvelteKit's built-in origin check for form actions (it runs before `handle`
 * and relies on `ORIGIN` in production).
 */
import { randomUUID } from 'node:crypto';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { DrizzleError, DrizzleQueryError } from 'drizzle-orm/errors';
import { createAdminGuard, isAdminRequest } from '#lib/server/auth/admin-guard.js';
import { ADMIN_ACTION_RATE_LIMIT, createTokenBucketLimiter } from '#lib/server/auth/rate-limit.js';
import { withSecurityHeaders } from '#lib/server/auth/security-headers.js';
import { getConfig } from '#lib/server/config.js';

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
	return withSecurityHeaders(response, { admin });
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
			message: sanitizeErrorMessage(error)
		})
	);
	return {
		message: `เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง (รหัสอ้างอิง ${errorId})`,
		error_id: errorId
	};
};

/**
 * One line: error name and message, file paths redacted, capped. Never the stack. Query errors
 * (Drizzle wraps the driver error and puts the SQL text, and for `DrizzleQueryError` the
 * params, in the message) log only the error name plus the cause's name/code, so no SQL or
 * bound value reaches the log.
 */
function sanitizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) return 'unknown error';
	const isQueryError = error instanceof DrizzleQueryError || error instanceof DrizzleError;
	if (isQueryError || SQL_LIKE.test(error.message)) {
		// `DrizzleQueryError` does not set `name` (it stays "Error").
		const name = error instanceof DrizzleQueryError ? 'DrizzleQueryError' : error.name;
		const cause = error.cause instanceof Error ? error.cause : null;
		const code = cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : null;
		return [name, cause?.name, code].filter(Boolean).join(': ') + ' [query redacted]';
	}
	return `${error.name}: ${error.message}`
		.replace(/(?:[A-Za-z]:)?(?:[\\/][\w.-]+){2,}/g, '[path]')
		.replace(/\s+/g, ' ')
		.slice(0, MAX_LOGGED_MESSAGE_LENGTH);
}

/** A statement keyword followed by its clause, or a bound-parameter dump. */
const SQL_LIKE =
	/\b(?:select|insert|update|delete|replace|pragma|create|drop|alter)\b[\s\S]*\b(?:from|into|set|table|where|values)\b|\bparams:/i;
