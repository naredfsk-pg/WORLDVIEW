/**
 * Cloudflare Access JWT verification for `/admin*` (ARCHITECTURE §4). Cloudflare Access protects
 * the path at the edge; the app verifies the `Cf-Access-Jwt-Assertion` header again here
 * (defence in depth) and fails closed on anything unexpected.
 *
 * - keys: the team's remote JWKS, cached in memory by `jose`
 * - checks: RS256 only, issuer = team URL, audience = `CF_ACCESS_AUD`, `exp` required, 60 s clock tolerance
 * - identity: the lower-cased `email` claim must be in `ADMIN_ALLOWED_EMAILS`
 */
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { AdminIdentity } from '../../types/views';
import { ConfigError, requireCloudflareAccess, type AppConfig } from '../config';

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
const CLOCK_TOLERANCE_SECONDS = 60;
const JWKS_TIMEOUT_MS = 5000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface AccessSettings {
	/** `https://<team>.cloudflareaccess.com` */
	issuer: string;
	audience: string;
	/** Lower-cased. */
	allowedEmails: string[];
	jwksUrl: string;
}

export type AccessDenyReason =
	'missing_config' | 'missing_token' | 'invalid_token' | 'email_not_allowed' | 'jwks_unavailable';

export type AccessDecision =
	{ ok: true; admin: AdminIdentity } | { ok: false; status: 403 | 503; reason: AccessDenyReason };

export type AccessVerifier = (token: string | null) => Promise<AccessDecision>;

/** Null when any required variable is missing or the team domain is invalid: callers deny (403). */
export function resolveAccessSettings(config: AppConfig): AccessSettings | null {
	let access;
	try {
		access = requireCloudflareAccess(config);
	} catch (error) {
		if (error instanceof ConfigError) return null;
		throw error;
	}

	const issuer = normalizeTeamUrl(access.teamDomain);
	if (!issuer) return null;
	return {
		issuer,
		audience: access.aud,
		allowedEmails: access.adminAllowedEmails,
		jwksUrl: testJwksOverride(config) ?? `${issuer}/cdn-cgi/access/certs`
	};
}

/**
 * Accepts `team`, `team.cloudflareaccess.com` or `https://team.cloudflareaccess.com/`. Anything
 * that is not a `*.cloudflareaccess.com` host is rejected, so a typo can never point the JWKS
 * fetch at another host.
 */
export function normalizeTeamUrl(teamDomain: string): string | null {
	const host = teamDomain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/+$/, '');
	const fullHost = host.includes('.') ? host : `${host}.cloudflareaccess.com`;
	if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(fullHost)) return null;
	return `https://${fullHost}`;
}

/**
 * Test-only JWKS URL (`CF_ACCESS_TEST_JWKS_URL`) so e2e can run real verification against a
 * production build. Honoured only when ALL of these hold, otherwise ignored:
 * - `NODE_ENV=test` (the production image runs with `NODE_ENV=production`)
 * - `ORIGIN` is a loopback origin, so never the public hostname
 * - the JWKS URL itself is loopback, so keys can only come from this machine
 * The issuer and audience checks stay unchanged.
 */
export function testJwksOverride(config: AppConfig): string | null {
	const url = config.cloudflare.testJwksUrl;
	if (!url || config.nodeEnv !== 'test') return null;
	const origin = config.server.origin;
	if (!origin || !isLoopbackUrl(origin) || !isLoopbackUrl(url)) return null;
	return url;
}

export function createAccessVerifier(settings: AccessSettings): AccessVerifier {
	const jwks = createRemoteJWKSet(new URL(settings.jwksUrl), { timeoutDuration: JWKS_TIMEOUT_MS });

	return async (token) => {
		if (!token) return { ok: false, status: 403, reason: 'missing_token' };

		let payload;
		try {
			({ payload } = await jwtVerify(token, jwks, {
				issuer: settings.issuer,
				audience: settings.audience,
				algorithms: ['RS256'],
				clockTolerance: CLOCK_TOLERANCE_SECONDS,
				requiredClaims: ['exp']
			}));
		} catch (error) {
			return isJwksUnavailable(error)
				? { ok: false, status: 503, reason: 'jwks_unavailable' }
				: { ok: false, status: 403, reason: 'invalid_token' };
		}

		// Plain ASCII only, checked BEFORE lower-casing: Unicode case mapping would turn a Kelvin
		// sign (U+212A) into "k" and let a look-alike address match the allowlist.
		const claim = payload.email;
		const email = typeof claim === 'string' && isAsciiEmail(claim) ? claim.toLowerCase() : '';
		if (!email || !settings.allowedEmails.includes(email)) {
			return { ok: false, status: 403, reason: 'email_not_allowed' };
		}
		return { ok: true, admin: { email } };
	};
}

/**
 * The key set could not be loaded (timeout, network error, non-200 or invalid JSON), as opposed
 * to a bad token. `jose` throws a plain `JOSEError` for a non-200 response and lets fetch's own
 * error through for network failures. Both outcomes deny access; only the status differs.
 */
function isJwksUnavailable(error: unknown): boolean {
	if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true;
	if (!(error instanceof errors.JOSEError)) return true;
	return error.code === errors.JOSEError.code;
}

/** Printable ASCII with no whitespace (`!` to `~`) around one `@`: the shape of an allowed address. */
export function isAsciiEmail(value: string): boolean {
	return /^[!-?A-~]+@[!-?A-~]+$/.test(value);
}

/** `localhost`, `127.0.0.1` or `[::1]` exactly (URL hostnames are already lower-cased). */
export function isLoopbackHost(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname);
}

function isLoopbackUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
	} catch {
		return false;
	}
}
