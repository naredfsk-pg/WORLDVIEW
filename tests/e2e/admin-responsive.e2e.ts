import { expect, test } from '@playwright/test';
import {
	ADMIN_ROUTES,
	expectNoHorizontalOverflow,
	SPEC_WIDTHS,
	THEMES,
	useAdminToken
} from './qa-helpers';

/**
 * PRD §11 #1 for the admin area: every admin page at the UI_DESIGN_SPEC §8 widths in both themes
 * renders with no horizontal overflow. Read-only, so it can run beside admin.e2e.ts.
 */
for (const width of SPEC_WIDTHS) {
	for (const colorScheme of THEMES) {
		test(`admin pages at ${width}px (${colorScheme}) have no horizontal overflow`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ colorScheme });
			await useAdminToken(page);
			for (const route of ADMIN_ROUTES) {
				const response = await page.goto(route);
				expect(response?.status(), route).toBe(200);
				await expect(page.locator('h1').first()).toBeVisible();
				await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
				await expectNoHorizontalOverflow(page);
			}
		});
	}
}
