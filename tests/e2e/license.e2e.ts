import { expect, test } from '@playwright/test';

// AGPL-3.0 §13: every page offers network users the source code.
test('footer offers the source code and states the licenses', async ({ page }) => {
	for (const path of ['/', '/academy']) {
		await page.goto(path);
		const footer = page.getByTestId('site-license');
		await expect(footer).toBeVisible();
		await expect(footer).toContainText('AGPL-3.0');
		await expect(footer).toContainText('CC BY-NC-SA 4.0');
		await expect(footer.getByRole('link', { name: 'ซอร์สโค้ด (GitHub)' })).toHaveAttribute(
			'href',
			'https://github.com/naredfsk-pg/WORLDVIEW'
		);
	}
});
