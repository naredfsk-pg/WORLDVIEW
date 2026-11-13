import { expect, test } from '@playwright/test';
import { signAccessToken } from './admin-auth';
import { watchCsp } from './csp-watch';

/**
 * CSP on the admin area of the production build (no dev bypass), signed in with the e2e
 * Cloudflare Access token (admin-auth.ts). Public routes: security.e2e.ts.
 */
const ADMIN_PAGES = [
	'/admin',
	'/admin/review',
	'/admin/events/demo-evt-01',
	'/admin/relations',
	'/admin/briefs',
	'/admin/jobs'
];

for (const colorScheme of ['light', 'dark'] as const) {
	test(`admin pages have no CSP violations (${colorScheme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme });
		await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': await signAccessToken() });
		const csp = await watchCsp(page);

		for (const path of ADMIN_PAGES) {
			const response = await page.goto(path);
			expect(response?.status(), path).toBe(200);
			await expect(page.locator('h1').first()).toBeVisible();
			expect(await csp.firstTheme(), path).toEqual({ theme: colorScheme, beforeBody: true });
		}
		expect(csp.violations).toEqual([]);
	});
}

test('the admin deny page renders its inline style under its own CSP', async ({ page }) => {
	const csp = await watchCsp(page);
	const response = await page.goto('/admin');

	expect(response?.status()).toBe(403);
	await expect(page.locator('body')).toHaveCSS('display', 'grid');
	expect(csp.violations).toEqual([]);
});
