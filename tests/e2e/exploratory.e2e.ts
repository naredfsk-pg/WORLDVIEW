import { expect, test } from '@playwright/test';
import { PUBLIC_ROUTES } from './qa-helpers';

/**
 * Regression guards from the Wave 3 exploratory session (docs/qa/ACCEPTANCE.md, "Exploratory"):
 * keyboard entry points, the `/` shortcut, theme storage edge cases, archive calendar month
 * boundaries, the stale/demo states of the seeded database, and Thai text at 360 px.
 */
test.describe('keyboard', () => {
	test('the first Tab reaches the skip link, which moves to the main content', async ({ page }) => {
		await page.goto('/archive');
		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'ข้ามไปยังเนื้อหาหลัก' });
		await expect(skip).toBeFocused();
		await expect(skip).toBeInViewport();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main$/);
		await expect(page.locator('#main')).toBeAttached();
	});

	test('`/` typed inside the search field is text, and Ctrl+/ does not open search', async ({
		page
	}) => {
		await page.goto('/');
		await page.keyboard.press('Control+/');
		const dialog = page.getByRole('dialog', { name: 'ค้นหาข่าวและบทเรียน' });
		await expect(dialog).toBeHidden();

		await page.locator('body').press('/');
		await expect(dialog).toBeVisible();
		const field = dialog.getByLabel('คำค้นหา');
		await expect(field).toBeFocused();
		await field.press('/');
		await field.pressSequentially('a/b');
		await expect(field).toHaveValue('/a/b');
		await expect(page.getByRole('dialog')).toHaveCount(1);
	});
});

test.describe('theme', () => {
	test('an invalid stored theme falls back to the OS preference', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.addInitScript(() => localStorage.setItem('worldview:theme', 'purple'));
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('a saved theme wins over the OS preference on every page', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.addInitScript(() => localStorage.setItem('worldview:theme', 'light'));
		for (const route of ['/', '/academy', '/archive', '/events/demo-evt-01']) {
			await page.goto(route);
			await expect(page.locator('html'), route).toHaveAttribute('data-theme', 'light');
		}
	});
});

test.describe('archive calendar month boundaries', () => {
	test('previous/next cross the year boundary in both directions', async ({ page }) => {
		await page.goto('/archive?month=2026-01');
		await expect(page.getByRole('link', { name: 'เดือนก่อนหน้า' })).toHaveAttribute(
			'href',
			/month=2025-12/
		);
		// Past months only: future months are out of range since BUG-QA-007.
		await page.goto('/archive?month=2025-12');
		await expect(page.getByRole('link', { name: 'เดือนถัดไป' })).toHaveAttribute(
			'href',
			/month=2026-01/
		);
	});

	test('month lengths: Feb 2024 has 29 days, Feb 2025 has 28', async ({ page }) => {
		for (const [month, days] of [
			['2024-02', 29],
			['2025-02', 28],
			['2026-04', 30]
		] as const) {
			await page.goto(`/archive?month=${month}`);
			const cells = page.getByTestId('archive-calendar').locator('td').filter({ hasText: /\d/ });
			await expect(cells, month).toHaveCount(days);
		}
	});

	test('a month without briefs shows the empty state; invalid input never 500s', async ({
		page,
		request
	}) => {
		await page.goto('/archive?month=2026-10');
		await expect(page.getByTestId('empty-state')).toContainText('เดือนนี้ยังไม่มีสรุปข่าว');
		for (const query of ['month=2026-13', 'month=abc', 'month=1969-12', 'date=2026-02-30']) {
			expect((await request.get(`/archive?${query}`)).status(), query).toBe(200);
		}
	});

	test('BUG-QA-007: a future date is not offered as "news of that day"', async ({ page }) => {
		const response = await page.goto('/archive?date=2099-01-01');
		// Header-only clients decode Thai correctly too (they fell back to ISO-8859-1 before).
		expect(response?.headers()['content-type']).toBe('text/html; charset=utf-8');
		const headline = page.getByTestId('archive-headline');
		await expect(headline).not.toContainText('2099');
		// Out of range is treated like an invalid date: the latest brief, with a clean Thai headline.
		await expect(headline).toHaveText(/^ข่าวประจำวันที่ \d{1,2} [ก-๙.]+ \d{4}$/);

		await page.goto('/archive?month=2099-01');
		await expect(page.locator('#calendar-title')).not.toContainText('2099');

		// No next-month link from the current Bangkok month.
		await page.goto(`/archive?month=${currentBangkokMonth()}`);
		await expect(page.getByRole('link', { name: 'เดือนก่อนหน้า' })).toHaveCount(1);
		await expect(page.getByRole('link', { name: 'เดือนถัดไป' })).toHaveCount(0);
	});
});

test.describe('empty, stale and demo states (seeded database, no ingest yet)', () => {
	test('the shell says the data may be stale and that it contains demo data', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('freshness')).toContainText('ข้อมูลอาจไม่เป็นปัจจุบัน');
		await expect(page.getByTestId('demo-notice')).toBeVisible();
	});

	test('a search with no results shows the empty state', async ({ page }) => {
		await page.goto('/search?q=zzqqxxไม่มีผลลัพธ์');
		await expect(page.getByTestId('empty-state')).toBeVisible();
	});
});

test.describe('Thai text at 360 px', () => {
	test.use({ viewport: { width: 360, height: 780 } });

	// Text blocks only: link cards clip decorative artwork on purpose (overflow: hidden), and
	// visually hidden headings (`.sr-only`, e.g. the brief's h2) are a 1px clipped box by design.
	test('no heading or paragraph is clipped by its own box on the main routes', async ({ page }) => {
		for (const route of PUBLIC_ROUTES) {
			await page.goto(route);
			const clipped = await page.locator('main').evaluate((main) =>
				[...main.querySelectorAll('h1, h2, h3, h4, p')]
					.filter((node) => !node.closest('.sr-only'))
					.filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
					.filter((node) => getComputedStyle(node).overflowX !== 'visible')
					.map((node) => node.textContent?.trim().slice(0, 40))
			);
			expect.soft(clipped, route).toEqual([]);
		}
	});
});

/** `YYYY-MM` of today in Asia/Bangkok (en-CA formats dates as YYYY-MM-DD). */
function currentBangkokMonth(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })
		.format(new Date())
		.slice(0, 7);
}
