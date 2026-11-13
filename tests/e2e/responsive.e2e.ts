import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, PUBLIC_ROUTES, SPEC_WIDTHS, THEMES } from './qa-helpers';

/**
 * PRD §11 #1, extended to the UI_DESIGN_SPEC §8 checklist: every main public route at
 * 360/390/430/768/1024/1440 px in both themes renders with no horizontal overflow.
 * (ui.e2e.ts keeps its 375/1440 check; admin routes are in admin-responsive.e2e.ts.)
 */
for (const width of SPEC_WIDTHS) {
	for (const colorScheme of THEMES) {
		test.describe(`public routes at ${width}px (${colorScheme})`, () => {
			test.use({ viewport: { width, height: 900 }, colorScheme });

			for (const route of PUBLIC_ROUTES) {
				test(`${route} has no horizontal overflow`, async ({ page }) => {
					const response = await page.goto(route);
					expect(response?.status()).toBe(200);
					await expect(page.locator('h1').first()).toBeVisible();
					await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
					await expectNoHorizontalOverflow(page);
				});
			}
		});
	}
}
