import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';
import {
	E2E_ADMIN_EMAIL,
	E2E_AUD,
	E2E_ISSUER,
	E2E_KID,
	E2E_LLM_KEY_SENTINEL,
	PRIVATE_JWK_ENV
} from './admin-auth';
import { PUBLIC_ROUTES } from './qa-helpers';

/**
 * PRD §11 #9 (failure) and #10 (security) against the production build.
 *
 * The whole e2e preview runs with the LLM pointed at a closed loopback port and a sentinel API
 * key in both the build and preview environments (admin-auth.ts `llmSentinelEnv`). So "the
 * pages render" here already means "they render with the LLM down", and the sentinel must never
 * appear in the client bundle or in any response.
 */
const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

test.describe('acceptance #9: archive and academy keep working with the LLM down', () => {
	for (const route of [
		'/archive',
		'/archive?date=2026-11-12',
		'/academy',
		'/academy/week/2/day/8',
		'/brief/2026-11-12',
		'/events/demo-evt-01',
		'/search?q=AI'
	]) {
		test(`${route} renders with its last-updated label`, async ({ page }) => {
			const response = await page.goto(route);
			expect(response?.status()).toBe(200);
			await expect(page.locator('h1').first()).toBeVisible();
			await expect(page.getByTestId('freshness')).toContainText('อัปเดตล่าสุด');
		});
	}

	test('/health still answers 200 with a working database', async ({ request }) => {
		const response = await request.get('/health');
		expect(response.status()).toBe(200);
		expect(await response.json()).toMatchObject({ db: 'ok' });
	});
});

test.describe('acceptance #10: no API key reaches the client', () => {
	test('the client bundle contains neither the planted LLM key nor LLM env names', () => {
		const files = listFiles('build/client');
		expect(files.length).toBeGreaterThan(0);
		const leaking = files.filter((file) => {
			const text = readFileSync(file, 'utf8');
			return (
				text.includes(E2E_LLM_KEY_SENTINEL) || /LLM_API_KEY|OMNI_API_KEY|LLM_BASE_URL/.test(text)
			);
		});
		expect(leaking).toEqual([]);
	});

	test('no public page or data endpoint returns the planted key or the LLM URL', async ({
		request
	}) => {
		for (const route of PUBLIC_ROUTES) {
			const [path, query] = route.split('?');
			const dataPath = `${path === '/' ? '' : path}/__data.json${query ? `?${query}` : ''}`;
			for (const url of [route, dataPath]) {
				const response = await request.get(url);
				expect.soft(response.status(), url).toBe(200);
				const body = await response.text();
				expect.soft(body.includes(E2E_LLM_KEY_SENTINEL), `${url} leaks the key`).toBe(false);
				expect.soft(body.includes('127.0.0.1:9'), `${url} leaks the LLM URL`).toBe(false);
			}
		}
	});
});

test.describe('acceptance #10: admin writes fail without valid authentication', () => {
	const ADMIN_WRITES: { path: string; form: Record<string, string> }[] = [
		{ path: '/admin/review?/publish', form: { id: 'demo-evt-13', change_reason: 'ไม่มีสิทธิ์' } },
		{ path: '/admin/review?/hide', form: { id: 'demo-evt-01', change_reason: 'ไม่มีสิทธิ์' } },
		{ path: '/admin/review?/flag', form: { id: 'demo-evt-01', change_reason: 'ไม่มีสิทธิ์' } },
		{
			path: '/admin/events/demo-evt-01?/save',
			form: { title_th: 'แก้โดยไม่มีสิทธิ์', change_reason: 'ไม่มีสิทธิ์' }
		},
		{ path: '/admin/events/demo-evt-01?/hide', form: { id: 'demo-evt-01', change_reason: 'x' } },
		{ path: '/admin/relations?/approve', form: { id: 'demo-rel-01', change_reason: 'x' } },
		{ path: '/admin/relations?/reject', form: { id: 'demo-rel-01', change_reason: 'x' } },
		{ path: '/admin/briefs?/visibility', form: { id: 'x', status: 'hidden', change_reason: 'x' } },
		{ path: '/admin/jobs?/rerun', form: { job_type: 'ingest', change_reason: 'ไม่มีสิทธิ์' } }
	];

	test('every admin form action is 403 without a token, and nothing changes', async ({
		request
	}) => {
		for (const write of ADMIN_WRITES) {
			const response = await request.post(write.path, { form: write.form });
			expect.soft(response.status(), write.path).toBe(403);
		}
		expect((await request.get('/events/demo-evt-13')).status()).toBe(404);
		expect((await request.get('/events/demo-evt-01')).status()).toBe(200);
	});

	test('admin data endpoints are 403 without a token', async ({ request }) => {
		for (const path of [
			'/admin/__data.json',
			'/admin/review/__data.json',
			'/admin/events/demo-evt-13/__data.json',
			'/admin/jobs/__data.json'
		]) {
			const response = await request.get(path);
			expect.soft(response.status(), path).toBe(403);
			expect.soft(await response.text(), path).not.toContain(E2E_ADMIN_EMAIL);
		}
	});

	test('forged, expired, unsigned and malformed tokens are all 403', async ({ request }) => {
		const tokens: Record<string, string> = {
			'signed by another key with the same kid': await signWith(await foreignKey(), {}),
			expired: await signWith(await realKey(), { expired: true }),
			'another issuer': await signWith(await realKey(), {
				issuer: 'https://evil.cloudflareaccess.com'
			}),
			'alg none': unsignedToken(),
			garbage: 'not.a.jwt',
			empty: ''
		};
		for (const [name, token] of Object.entries(tokens)) {
			const headers = { [ACCESS_HEADER]: token };
			expect.soft((await request.get('/admin', { headers })).status(), `GET ${name}`).toBe(403);
			const post = await request.post('/admin/review?/publish', {
				headers,
				form: { id: 'demo-evt-13', change_reason: 'ปลอม' }
			});
			expect.soft(post.status(), `POST ${name}`).toBe(403);
		}
		expect((await request.get('/events/demo-evt-13')).status()).toBe(404);
	});
});

async function realKey() {
	const raw = process.env[PRIVATE_JWK_ENV];
	if (!raw) throw new Error(`${PRIVATE_JWK_ENV} is not set: did the global setup run?`);
	return importJWK(JSON.parse(raw) as JWK, 'RS256');
}

async function foreignKey() {
	return (await generateKeyPair('RS256')).privateKey;
}

async function signWith(
	key: Awaited<ReturnType<typeof realKey>>,
	options: { expired?: boolean; issuer?: string }
): Promise<string> {
	const nowSeconds = Math.floor(Date.now() / 1000);
	return new SignJWT({ email: E2E_ADMIN_EMAIL })
		.setProtectedHeader({ alg: 'RS256', kid: E2E_KID })
		.setIssuer(options.issuer ?? E2E_ISSUER)
		.setAudience(E2E_AUD)
		.setIssuedAt(options.expired ? nowSeconds - 3600 : nowSeconds)
		.setExpirationTime(options.expired ? nowSeconds - 1800 : nowSeconds + 600)
		.sign(key);
}

function unsignedToken(): string {
	const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const nowSeconds = Math.floor(Date.now() / 1000);
	return `${encode({ alg: 'none', kid: E2E_KID })}.${encode({
		email: E2E_ADMIN_EMAIL,
		iss: E2E_ISSUER,
		aud: E2E_AUD,
		iat: nowSeconds,
		exp: nowSeconds + 600
	})}.`;
}

function listFiles(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? listFiles(path) : [path];
	});
}
