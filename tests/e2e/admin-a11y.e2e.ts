import { expect, test } from '@playwright/test';
import { scanPage, unexpectedSerious } from './a11y-helpers';
import { ADMIN_ROUTES, THEMES, useAdminToken } from './qa-helpers';

/**
 * axe-core on every admin page in both themes. Read-only. No known serious violations: the
 * shell's logo link (BUG-QA-001) was fixed in Wave 3; its regression test is in a11y.e2e.ts.
 */
for (const colorScheme of THEMES) {
	test(`admin pages (${colorScheme}) have no new serious or critical violations`, async ({
		page
	}, testInfo) => {
		await page.emulateMedia({ colorScheme });
		await useAdminToken(page);
		for (const route of ADMIN_ROUTES) {
			const response = await page.goto(route);
			expect(response?.status(), route).toBe(200);
			const nodes = await scanPage(page, testInfo, `${route} ${colorScheme}`);
			expect.soft(unexpectedSerious(nodes), route).toEqual([]);
		}
	});
}
