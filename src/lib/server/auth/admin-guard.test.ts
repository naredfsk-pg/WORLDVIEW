import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../config';
import { createAdminGuard, isAdminPath } from './admin-guard';
import {
	createAccessVerifier,
	normalizeTeamUrl,
	resolveAccessSettings,
	testJwksOverride
} from './cloudflare-access';
import { createTokenBucketLimiter, type RateLimiter } from './rate-limit';

const TEAM_URL = 'https://worldview-test.cloudflareaccess.com';
const AUD = 'aud-test-123';
const ADMIN_EMAIL = 'editor@example.com';
const KID = 'test-key-1';

let privateKey: CryptoKey;
let jwksServer: Server;
let jwksUrl: string;
/** A loopback URL nobody listens on. */
let deadJwksUrl: string;

beforeAll(async () => {
	const pair = await generateKeyPair('RS256');
	privateKey = pair.privateKey;
	const publicJwk: JWK = {
		...(await exportJWK(pair.publicKey)),
		kid: KID,
		alg: 'RS256',
		use: 'sig'
	};

	jwksServer = createServer((request, response) => {
		if (request.url !== '/certs') {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ keys: [publicJwk] }));
	});
	await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
	jwksUrl = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/certs`;

	const closed = createServer();
	await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
	deadJwksUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/certs`;
	await new Promise<void>((resolve) => closed.close(() => resolve()));
});

afterAll(async () => {
	await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

function testEnv(overrides: Record<string, string | undefined> = {}) {
	return {
		NODE_ENV: 'test',
		ORIGIN: 'http://localhost:4273',
		CF_ACCESS_TEAM_DOMAIN: 'worldview-test',
		CF_ACCESS_AUD: AUD,
		ADMIN_ALLOWED_EMAILS: 'Editor@Example.com, other@example.com',
		CF_ACCESS_TEST_JWKS_URL: jwksUrl,
		...overrides
	};
}

function signToken(
	options: { email?: string | null; issuer?: string; audience?: string; expiresAt?: number } = {}
): Promise<string> {
	const claims = options.email === null ? {} : { email: options.email ?? ADMIN_EMAIL };
	const nowSeconds = Math.floor(Date.now() / 1000);
	return new SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid: KID })
		.setIssuer(options.issuer ?? TEAM_URL)
		.setAudience(options.audience ?? AUD)
		.setIssuedAt(nowSeconds - 10)
		.setExpirationTime(options.expiresAt ?? nowSeconds + 300)
		.sign(privateKey);
}

function base64url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function adminEvent(
	options: { token?: string; method?: string; path?: string; ip?: string } = {}
): RequestEvent {
	const url = new URL(options.path ?? '/admin', 'http://localhost:4273');
	const headers = new Headers();
	if (options.token) headers.set('Cf-Access-Jwt-Assertion', options.token);
	return {
		url,
		request: new Request(url, { method: options.method ?? 'GET', headers }),
		locals: {},
		getClientAddress: () => options.ip ?? '203.0.113.7'
	} as unknown as RequestEvent;
}

function guardFor(
	env: Record<string, string | undefined>,
	options: { devBypass?: boolean; limiter?: RateLimiter } = {}
) {
	const config = parseConfig(env);
	return createAdminGuard({
		getConfig: () => config,
		devBypassIdentity: options.devBypass ? { email: 'dev@localhost' } : null,
		limiter:
			options.limiter ??
			createTokenBucketLimiter({ capacity: 100, refillPerSecond: 1, maxKeys: 10 })
	});
}

async function run(guard: ReturnType<typeof guardFor>, event: RequestEvent) {
	const resolve = vi.fn(async () => new Response('admin page'));
	const response = await guard({ event, resolve });
	return { response, resolve };
}

describe('admin guard (Cloudflare Access)', () => {
	it('allows a valid token and sets locals.admin with the lower-cased email', async () => {
		const event = adminEvent({ token: await signToken({ email: 'Editor@Example.com' }) });
		const { response, resolve } = await run(guardFor(testEnv()), event);

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
		expect(event.locals.admin).toEqual({ email: ADMIN_EMAIL });
		expect(event.locals.adminDevBypass).toBe(false);
	});

	it('accepts a token expired less than the 60 s clock tolerance ago', async () => {
		const expiresAt = Math.floor(Date.now() / 1000) - 30;
		const { response } = await run(
			guardFor(testEnv()),
			adminEvent({ token: await signToken({ expiresAt }) })
		);
		expect(response.status).toBe(200);
	});

	const deniedCases: [string, () => Promise<string | undefined>][] = [
		['missing header', async () => undefined],
		['wrong audience', () => signToken({ audience: 'another-app' })],
		['wrong issuer', () => signToken({ issuer: 'https://evil.cloudflareaccess.com' })],
		['expired', () => signToken({ expiresAt: Math.floor(Date.now() / 1000) - 120 })],
		['email not on the allowlist', () => signToken({ email: 'intruder@example.com' })],
		['no email claim', () => signToken({ email: null })],
		['malformed token', async () => 'not-a-jwt'],
		[
			'HS256 (wrong algorithm)',
			() =>
				new SignJWT({ email: ADMIN_EMAIL })
					.setProtectedHeader({ alg: 'HS256', kid: KID })
					.setIssuer(TEAM_URL)
					.setAudience(AUD)
					.setExpirationTime('5m')
					.sign(new TextEncoder().encode('a-shared-secret-that-is-long-enough!'))
		],
		[
			'alg none (unsigned)',
			async () => {
				const payload = {
					email: ADMIN_EMAIL,
					iss: TEAM_URL,
					aud: AUD,
					exp: Math.floor(Date.now() / 1000) + 300
				};
				return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
			}
		]
	];

	for (const [name, makeToken] of deniedCases) {
		it(`returns 403 for ${name}`, async () => {
			const event = adminEvent({ token: await makeToken() });
			const { response, resolve } = await run(guardFor(testEnv()), event);

			expect(response.status).toBe(403);
			expect(resolve).not.toHaveBeenCalled();
			expect(event.locals.admin).toBeUndefined();
			const body = await response.text();
			expect(body).toContain('ไม่มีสิทธิ์เข้าถึง');
			// No details: nothing about tokens, claims or configuration.
			expect(body).not.toMatch(/aud|issuer|jwt|token|email/i);
		});
	}

	it('returns 403 for a token signed by another key', async () => {
		const other = await generateKeyPair('RS256');
		const token = await new SignJWT({ email: ADMIN_EMAIL })
			.setProtectedHeader({ alg: 'RS256', kid: KID })
			.setIssuer(TEAM_URL)
			.setAudience(AUD)
			.setExpirationTime('5m')
			.sign(other.privateKey);
		const { response } = await run(guardFor(testEnv()), adminEvent({ token }));
		expect(response.status).toBe(403);
	});

	for (const missing of ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'ADMIN_ALLOWED_EMAILS']) {
		it(`returns 403 for every request when ${missing} is missing`, async () => {
			const event = adminEvent({ token: await signToken() });
			const { response, resolve } = await run(guardFor(testEnv({ [missing]: undefined })), event);
			expect(response.status).toBe(403);
			expect(resolve).not.toHaveBeenCalled();
		});
	}

	it('returns 403 when the team domain is not a cloudflareaccess.com host', async () => {
		const event = adminEvent({ token: await signToken() });
		const env = testEnv({ CF_ACCESS_TEAM_DOMAIN: 'https://evil.example.com' });
		expect((await run(guardFor(env), event)).response.status).toBe(403);
	});

	it('returns 503 when the JWKS cannot be fetched', async () => {
		const event = adminEvent({ token: await signToken() });
		const env = testEnv({ CF_ACCESS_TEST_JWKS_URL: deadJwksUrl });
		const { response, resolve } = await run(guardFor(env), event);

		expect(response.status).toBe(503);
		expect(resolve).not.toHaveBeenCalled();
		expect(await response.text()).toContain('ไม่พร้อมใช้งานชั่วคราว');
	});

	it('applies to form POSTs too', async () => {
		const { response } = await run(guardFor(testEnv()), adminEvent({ method: 'POST' }));
		expect(response.status).toBe(403);
	});
});

describe('dev bypass', () => {
	const devEnv = { NODE_ENV: 'development' };

	it('works only with a dev identity, NODE_ENV=development and no CF_ACCESS_AUD', async () => {
		const event = adminEvent();
		const { response } = await run(guardFor(devEnv, { devBypass: true }), event);

		expect(response.status).toBe(200);
		expect(event.locals.admin).toEqual({ email: 'dev@localhost' });
		expect(event.locals.adminDevBypass).toBe(true);
	});

	it('cannot be active in a production build: the dev identity is null there', async () => {
		// hooks.server.ts passes `import.meta.env.DEV ? identity : null`, which `vite build` compiles to null.
		for (const env of [devEnv, { NODE_ENV: 'production' }]) {
			const { response, resolve } = await run(guardFor(env, { devBypass: false }), adminEvent());
			expect(response.status).toBe(403);
			expect(resolve).not.toHaveBeenCalled();
		}
	});

	it('is refused with NODE_ENV=production even if a dev identity were passed', async () => {
		const guard = guardFor({ NODE_ENV: 'production' }, { devBypass: true });
		expect((await run(guard, adminEvent())).response.status).toBe(403);
	});

	it('is off once CF_ACCESS_AUD is set: a token is required', async () => {
		const env = { ...devEnv, CF_ACCESS_AUD: AUD };
		expect((await run(guardFor(env, { devBypass: true }), adminEvent())).response.status).toBe(403);
	});
});

describe('test-only JWKS override', () => {
	it('is used with NODE_ENV=test, a loopback ORIGIN and a loopback JWKS URL', () => {
		expect(testJwksOverride(parseConfig(testEnv()))).toBe(jwksUrl);
		expect(resolveAccessSettings(parseConfig(testEnv()))?.jwksUrl).toBe(jwksUrl);
	});

	it('is ignored when NODE_ENV is production or development', () => {
		for (const NODE_ENV of ['production', 'development']) {
			const config = parseConfig(testEnv({ NODE_ENV }));
			expect(testJwksOverride(config)).toBeNull();
			expect(resolveAccessSettings(config)?.jwksUrl).toBe(`${TEAM_URL}/cdn-cgi/access/certs`);
		}
	});

	it('is ignored when ORIGIN is the public host (or missing)', () => {
		for (const ORIGIN of ['https://worldview.nared-fu.com', undefined]) {
			const config = parseConfig(testEnv({ ORIGIN }));
			expect(testJwksOverride(config)).toBeNull();
			expect(resolveAccessSettings(config)?.jwksUrl).toBe(`${TEAM_URL}/cdn-cgi/access/certs`);
		}
	});

	it('is ignored when the JWKS URL is not loopback', () => {
		const config = parseConfig(
			testEnv({ CF_ACCESS_TEST_JWKS_URL: 'https://keys.example.com/certs' })
		);
		expect(testJwksOverride(config)).toBeNull();
	});

	it('in production a token signed by the test key is not trusted', async () => {
		const config = parseConfig(testEnv({ NODE_ENV: 'production' }));
		const settings = resolveAccessSettings(config);
		expect(settings?.jwksUrl).not.toContain('127.0.0.1');
		// Same issuer/audience, but the verifier only trusts the given key set: a dead one here
		// stands in for the real team JWKS (no network in tests).
		const verify = createAccessVerifier({ ...settings!, jwksUrl: deadJwksUrl });
		const decision = await verify(await signToken());
		expect(decision.ok).toBe(false);
	});
});

describe('rate limit on admin POSTs', () => {
	it('returns 429 with Retry-After once the burst is used up, per client IP', async () => {
		const guard = guardFor(testEnv(), {
			limiter: createTokenBucketLimiter({ capacity: 2, refillPerSecond: 0.5, maxKeys: 10 })
		});
		const token = await signToken();
		const post = (ip: string) => run(guard, adminEvent({ token, method: 'POST', ip }));

		expect((await post('198.51.100.1')).response.status).toBe(200);
		expect((await post('198.51.100.1')).response.status).toBe(200);
		const limited = await post('198.51.100.1');
		expect(limited.response.status).toBe(429);
		expect(limited.response.headers.get('retry-after')).toBe('2');
		expect(limited.resolve).not.toHaveBeenCalled();
		// Another client still has its own bucket; GETs are not limited.
		expect((await post('198.51.100.2')).response.status).toBe(200);
		expect((await run(guard, adminEvent({ token, ip: '198.51.100.1' }))).response.status).toBe(200);
	});
});

describe('path and team URL normalization', () => {
	it('matches /admin and /admin/* the way SvelteKit routes them', () => {
		for (const path of ['/admin', '/admin/', '/admin/review', '/%61dmin/review', '/ADMIN']) {
			expect(isAdminPath(path), path).toBe(true);
		}
		for (const path of ['/', '/administrator', '/events/admin', '/adminx']) {
			expect(isAdminPath(path), path).toBe(false);
		}
		// Undecodable: fail closed.
		expect(isAdminPath('/%E0%A4%A')).toBe(true);
	});

	it('normalizes the team domain and rejects other hosts', () => {
		expect(normalizeTeamUrl('worldview')).toBe('https://worldview.cloudflareaccess.com');
		expect(normalizeTeamUrl('Worldview.cloudflareaccess.com')).toBe(
			'https://worldview.cloudflareaccess.com'
		);
		expect(normalizeTeamUrl('https://worldview.cloudflareaccess.com/')).toBe(
			'https://worldview.cloudflareaccess.com'
		);
		expect(normalizeTeamUrl('https://evil.example.com')).toBeNull();
		expect(normalizeTeamUrl('a.cloudflareaccess.com.evil.com')).toBeNull();
	});
});
