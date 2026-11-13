import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { APP_THEME_SCRIPT_HASH, FALLBACK_CSP } from '../../src/lib/server/auth/csp';
import { watchCsp } from './csp-watch';

/**
 * Security hardening against the production build (ARCHITECTURE §4, "Security headers & CSP"):
 * no CSP violation on any public route in either theme, the theme set before first paint,
 * security headers on every kind of response that passes through `handle`, and no server
 * secrets or source in the client bundle. Admin pages: admin-security.e2e.ts.
 */

/** Seeded demo data (src/lib/server/db/fixtures/demo.ts). `/brief` redirects, `/nope` is a 404. */
const PUBLIC_ROUTES = [
	'/',
	'/academy',
	'/academy/week/1/day/1',
	'/archive',
	'/brief',
	'/brief/2026-11-12',
	'/connections',
	'/events/demo-evt-01',
	'/events/demo-evt-04',
	'/search?q=AI',
	'/nope'
];

test.describe('CSP: no violations on public routes', () => {
	for (const colorScheme of ['light', 'dark'] as const) {
		test.describe(colorScheme, () => {
			test.use({ colorScheme });

			for (const route of PUBLIC_ROUTES) {
				test(`${route} sets the ${colorScheme} theme before first paint`, async ({ page }) => {
					const csp = await watchCsp(page);
					await page.goto(route);
					await expect(page.locator('h1').first()).toBeVisible();

					expect(await csp.firstTheme()).toEqual({ theme: colorScheme, beforeBody: true });
					expect(csp.violations).toEqual([]);
				});
			}
		});
	}

	test('a saved theme beats the OS preference, with no flash', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.addInitScript(() => localStorage.setItem('worldview:theme', 'dark'));
		const csp = await watchCsp(page);
		await page.goto('/');

		expect(await csp.firstTheme()).toEqual({ theme: 'dark', beforeBody: true });
		expect(csp.violations).toEqual([]);
	});

	test('interactive widgets (search dialog, theme toggle, filters, calendar) stay clean', async ({
		page
	}) => {
		const csp = await watchCsp(page);
		await page.goto('/');
		await page.getByTestId('theme-toggle').click();
		await page.locator('body').press('/');
		const dialog = page.getByRole('dialog', { name: 'ค้นหาข่าวและบทเรียน' });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('คำค้นหา').fill('AI');
		await dialog.getByLabel('คำค้นหา').press('Enter');
		await expect(page).toHaveURL(/\/search\?q=AI/);

		await page.goto('/');
		await page.getByTestId('chip-economy').click();
		await expect(page).toHaveURL(/category=economy/);

		await page.goto('/archive?month=2026-11');
		await page.getByTestId('archive-calendar').locator('a[data-date="2026-11-11"]').click();
		await expect(page).toHaveURL(/date=2026-11-11/);

		expect(csp.violations).toEqual([]);
	});

	test('the static src/error.html renders its inline style under the fallback CSP', async ({
		page
	}) => {
		// SvelteKit serves error.html only when the root layout fails (e.g. the database is down),
		// and that response gets FALLBACK_CSP from `handle`. Serve the same pair here.
		const html = readFileSync('src/error.html', 'utf8')
			.replaceAll('%sveltekit.status%', '503')
			.replaceAll('%sveltekit.error.message%', 'ทดสอบ');
		await page.route('**/__error-page-csp', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'text/html; charset=utf-8',
				headers: { 'content-security-policy': FALLBACK_CSP },
				body: html
			})
		);
		const csp = await watchCsp(page);
		await page.goto('/__error-page-csp');

		await expect(page.locator('main')).toHaveCSS('border-radius', '20px');
		expect(csp.violations).toEqual([]);
	});
});

test.describe('security headers', () => {
	const BASELINE = {
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
		'referrer-policy': 'strict-origin-when-cross-origin',
		'cross-origin-opener-policy': 'same-origin',
		'cross-origin-resource-policy': 'same-origin'
	};

	test("pages carry SvelteKit's hash-mode CSP: theme hash plus the page's own script", async ({
		request
	}) => {
		for (const path of ['/', '/nope']) {
			const headers = (await request.get(path)).headers();
			expect(headers, path).toMatchObject(BASELINE);
			const scriptSrc = directive(headers['content-security-policy'], 'script-src');
			expect(scriptSrc, path).toContain(`'${APP_THEME_SCRIPT_HASH}'`);
			const hashes = scriptSrc.filter((source) => source.startsWith("'sha256-"));
			expect(hashes.length, path).toBeGreaterThanOrEqual(2);
			expect(scriptSrc, path).not.toContain("'unsafe-inline'");
			const policy = headers['content-security-policy'];
			expect(directive(policy, 'style-src'), path).not.toContain("'unsafe-inline'");
			expect(directive(policy, 'style-src-attr'), path).toEqual(["'unsafe-inline'"]);
		}
	});

	test('data, endpoint and deny responses carry the headers too', async ({ request }) => {
		for (const path of ['/academy/__data.json', '/health']) {
			const headers = (await request.get(path)).headers();
			expect(headers, path).toMatchObject(BASELINE);
			expect(headers['content-security-policy'], path).toBe(FALLBACK_CSP);
		}

		const deny = await request.get('/admin');
		expect(deny.status()).toBe(403);
		expect(deny.headers()).toMatchObject(BASELINE);
		expect(deny.headers()['content-security-policy']).toMatch(/^default-src 'none'; style-src/);
	});

	test('HSTS and upgrade-insecure-requests only when Cloudflare forwarded HTTPS', async ({
		request
	}) => {
		const plain = (await request.get('/')).headers();
		expect(plain['strict-transport-security']).toBeUndefined();
		expect(plain['content-security-policy']).not.toContain('upgrade-insecure-requests');

		const https = (await request.get('/', { headers: { 'x-forwarded-proto': 'https' } })).headers();
		expect(https['strict-transport-security']).toBe('max-age=15552000');
		expect(https['content-security-policy']).toMatch(/; upgrade-insecure-requests$/);
	});
});

test('the client bundle holds no env names, server paths, dev identity or source maps', () => {
	const files = ['build/client', '.svelte-kit/output/client'].flatMap(listFiles);
	expect(files.length).toBeGreaterThan(0);
	expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);

	// Every variable in .env.example and the config schema (`  NAME: z…`). HOST, PORT, ORIGIN and
	// NODE_ENV are generic words, not secrets.
	const declared = [
		...readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm),
		...readFileSync('src/lib/server/config.ts', 'utf8').matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)
	].map(([, name]) => name ?? '');
	const envNames = [...new Set(declared)].filter(
		(name) => !['HOST', 'PORT', 'ORIGIN', 'NODE_ENV'].includes(name)
	);
	expect(envNames).toEqual(
		expect.arrayContaining(['LLM_API_KEY', 'TUNNEL_TOKEN', 'CF_ACCESS_AUD'])
	);
	const forbidden = new RegExp(
		[
			`\\b(?:${envNames.join('|')})\\b`,
			'CF_ACCESS',
			'OMNI_',
			'LLM_',
			'TUNNEL',
			'dev@localhost',
			'lib/server/',
			'sourceMappingURL'
		].join('|')
	);

	const textFiles = files.filter((file) => !/\.(?:woff2?|png|jpe?g|webp|gif|ico)$/.test(file));
	expect(textFiles.some((file) => file.endsWith('.js'))).toBe(true);
	const leaks = textFiles.flatMap((file) => {
		const match = forbidden.exec(readFileSync(file, 'utf8'));
		return match ? [`${file}: ${match[0]}`] : [];
	});
	expect(leaks).toEqual([]);
});

function directive(policy: string | undefined, name: string): string[] {
	const entry = (policy ?? '').split(';').find((part) => part.trim().startsWith(`${name} `));
	return entry ? entry.trim().split(/\s+/).slice(1) : [];
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
