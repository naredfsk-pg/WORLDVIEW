/**
 * E2E auth fixture shared by playwright.config.ts, the e2e server launcher, the global setup and
 * the admin tests. The production build verifies real RS256 tokens against a loopback JWKS that
 * the global setup serves; `server/auth` honours `CF_ACCESS_TEST_JWKS_URL` only with
 * NODE_ENV=test and a loopback ORIGIN + JWKS URL (ARCHITECTURE §4).
 */
import { importJWK, SignJWT, type JWK } from 'jose';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
export const E2E_JWKS_PORT = Number(process.env.E2E_JWKS_PORT ?? E2E_PORT + 1);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
/** The e2e suite gets its own database, reset before every run, so the dev database is untouched. */
export const E2E_DATABASE_URL = 'file:./data/e2e.db';

const TEAM = 'worldview-e2e';
export const E2E_ISSUER = `https://${TEAM}.cloudflareaccess.com`;
export const E2E_AUD = 'worldview-e2e-aud';
export const E2E_ADMIN_EMAIL = 'e2e-admin@example.com';
export const E2E_KID = 'e2e-key';
/** Set by the global setup (process env reaches the test workers). */
export const PRIVATE_JWK_ENV = 'E2E_ACCESS_PRIVATE_JWK';

/** Environment for `vite preview` of the production build. */
export function previewEnv(): Record<string, string> {
	return {
		NODE_ENV: 'test',
		ORIGIN: E2E_BASE_URL,
		DATABASE_URL: E2E_DATABASE_URL,
		CF_ACCESS_TEAM_DOMAIN: TEAM,
		CF_ACCESS_AUD: E2E_AUD,
		ADMIN_ALLOWED_EMAILS: E2E_ADMIN_EMAIL,
		CF_ACCESS_TEST_JWKS_URL: `http://127.0.0.1:${E2E_JWKS_PORT}/certs`
	};
}

export async function signAccessToken(
	overrides: { email?: string; audience?: string } = {}
): Promise<string> {
	const raw = process.env[PRIVATE_JWK_ENV];
	if (!raw) throw new Error(`${PRIVATE_JWK_ENV} is not set: did the global setup run?`);
	const key = await importJWK(JSON.parse(raw) as JWK, 'RS256');
	return new SignJWT({ email: overrides.email ?? E2E_ADMIN_EMAIL })
		.setProtectedHeader({ alg: 'RS256', kid: E2E_KID })
		.setIssuer(E2E_ISSUER)
		.setAudience(overrides.audience ?? E2E_AUD)
		.setIssuedAt()
		.setExpirationTime('10m')
		.sign(key);
}
