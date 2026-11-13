import { expect, test, type Page } from '@playwright/test';

/** Seeded demo data (src/lib/server/db/fixtures/demo.ts), `npm run db:reset`. */
const MAIN_ROUTES = [
	'/',
	'/academy',
	'/academy/week/1/day/1',
	'/archive',
	'/brief/2026-11-12',
	'/connections',
	'/events/demo-evt-01',
	'/search?q=AI'
];

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };

async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [MOBILE, DESKTOP]) {
	for (const colorScheme of ['light', 'dark'] as const) {
		test.describe(`layout at ${viewport.width}px (${colorScheme})`, () => {
			test.use({ viewport, colorScheme });

			for (const route of MAIN_ROUTES) {
				test(`${route} loads without horizontal overflow`, async ({ page }) => {
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

test.describe('navigation shell', () => {
	test('mobile shows the bottom nav, not the sidebar', async ({ page }) => {
		await page.setViewportSize(MOBILE);
		await page.goto('/');
		await expect(page.getByRole('navigation', { name: 'นำทางหลัก' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toBeHidden();
		await expect(
			page.getByRole('navigation', { name: 'นำทางหลัก' }).getByRole('link', { name: 'วันนี้' })
		).toHaveAttribute('aria-current', 'page');
	});

	test('desktop shows the sidebar, not the bottom nav', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await page.goto('/academy');
		await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'นำทางหลัก' })).toBeHidden();
		await expect(
			page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('link', { name: 'เรียนรู้โลก' })
		).toHaveAttribute('aria-current', 'page');
	});

	test('the / key opens the search dialog, which navigates to /search', async ({ page }) => {
		await page.goto('/');
		await page.locator('body').press('/');
		const dialog = page.getByRole('dialog', { name: 'ค้นหาข่าวและบทเรียน' });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('คำค้นหา').fill('ชิป');
		await dialog.getByLabel('คำค้นหา').press('Enter');
		await expect(page).toHaveURL(/\/search\?q=%E0%B8%8A/);
		await expect(page.getByRole('status').filter({ hasText: 'ผลการค้นหา' })).toBeVisible();
	});
});

test('theme choice persists across a reload', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	const html = page.locator('html');
	await expect(html).toHaveAttribute('data-theme', 'light');

	const toggle = page.getByTestId('theme-toggle');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await toggle.click();
	await expect(html).toHaveAttribute('data-theme', 'dark');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');

	await page.reload();
	await expect(html).toHaveAttribute('data-theme', 'dark');
	expect(await page.evaluate(() => localStorage.getItem('worldview:theme'))).toBe('dark');
});

test('category chips filter Today and keep the choice in the URL', async ({ page }) => {
	await page.goto('/');
	const chip = page.getByTestId('chip-economy');
	await chip.click();
	await expect(page).toHaveURL(/[?&]category=economy/);
	await expect(chip).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'false');

	const cards = page.locator('[data-testid="story-card"], [data-testid="featured-story"]');
	await expect(cards.first()).toBeVisible();
	for (const category of await cards.evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute('data-category'))
	)) {
		expect(category).toBe('economy');
	}
});

test.describe('archive', () => {
	test('selecting a calendar date navigates to it', async ({ page }) => {
		await page.goto('/archive?month=2026-11');
		await page.getByTestId('archive-calendar').locator('a[data-date="2026-11-11"]').click();
		await expect(page).toHaveURL(/date=2026-11-11/);
		await expect(page.getByTestId('archive-headline')).toContainText('11 พ.ย. 2026');
		await expect(
			page.getByTestId('archive-calendar').locator('a[data-date="2026-11-11"]')
		).toHaveAttribute('aria-current', 'date');
		await expect(
			page.getByTestId('archive-results').getByTestId('story-card').first()
		).toBeVisible();
	});

	test('the date picker and category filter keep their state in the URL', async ({ page }) => {
		await page.goto('/archive');
		await page.getByLabel('เลือกวันที่').fill('2026-11-12');
		await page.getByRole('button', { name: 'ดูข่าว' }).click();
		await expect(page).toHaveURL(/date=2026-11-12/);
		await page.getByTestId('chip-energy').click();
		await expect(page).toHaveURL(
			/date=2026-11-12.*category=energy|category=energy.*date=2026-11-12/
		);
		await expect(page.getByTestId('archive-headline')).toContainText('12 พ.ย. 2026');
	});

	test('a date without a brief shows the empty state', async ({ page }) => {
		await page.goto('/archive?date=2026-11-02');
		await expect(page.getByTestId('empty-state')).toBeVisible();
	});
});

test.describe('events', () => {
	test('a pending_review event is a 404', async ({ page }) => {
		const response = await page.goto('/events/demo-evt-13');
		expect(response?.status()).toBe(404);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('ไม่พบหน้า');
	});

	test('event detail shows sections in order, sources, demo and timezone labels', async ({
		page
	}) => {
		await page.goto('/events/demo-evt-01');
		const headings = await page
			.getByTestId('event-detail')
			.locator('section > h2')
			.evaluateAll((nodes) => nodes.map((node) => node.id));
		expect(headings).toEqual([
			'facts',
			'why',
			'background',
			'uncertain',
			'sources',
			'timeline',
			'related-events',
			'related-lessons'
		]);
		await expect(page.getByText('ไม่ทราบเวลาเกิดเหตุ').first()).toBeVisible();
		await expect(page.getByText('ข้อมูลตัวอย่าง ไม่ใช่ข่าวจริง').first()).toBeVisible();
		await expect(page.getByText('เวลาไทย (GMT+7)').first()).toBeVisible();
		await expect(page.getByText(/AI-assisted/)).toBeVisible();
		const sourceLinks = page.locator('section[aria-labelledby="sources"] a[href^="https://"]');
		await expect(sourceLinks).toHaveCount(3);
		await expect(sourceLinks.first()).toHaveAttribute('rel', /noopener/);
	});

	test('potential_impact is labelled as possible, not confirmed', async ({ page }) => {
		await page.goto('/events/demo-evt-04');
		const relation = page.locator('[data-relation-type="potential_impact"]').first();
		await expect(relation).toContainText('อาจเกี่ยวข้อง/เป็นไปได้');
		await expect(relation).toContainText('ยังไม่ได้รับการยืนยัน');
	});

	test('single-source and correction labels are shown', async ({ page }) => {
		await page.goto('/events/demo-evt-05');
		await expect(page.getByText('แหล่งข่าวเดียว').first()).toBeVisible();
		await page.goto('/events/demo-evt-08');
		await expect(page.getByRole('complementary', { name: 'การแก้ไขข้อมูล' })).toBeVisible();
	});
});

test.describe('briefs', () => {
	test('/brief redirects to the latest brief', async ({ page }) => {
		await page.goto('/brief');
		await expect(page).toHaveURL(/\/brief\/\d{4}-\d{2}-\d{2}$/);
	});

	test('the best edition is chosen and other editions are linked', async ({ page }) => {
		await page.goto('/brief/2026-11-12');
		const editions = page.getByRole('navigation', { name: 'รอบของสรุปข่าว' });
		await expect(editions.getByRole('link', { name: 'สรุปประจำวัน' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await editions.getByRole('link', { name: 'รอบเช้า' }).click();
		await expect(page).toHaveURL(/edition=morning/);
	});

	test('invalid dates and editions are 404', async ({ request }) => {
		expect((await request.get('/brief/2026-02-30')).status()).toBe(404);
		expect((await request.get('/brief/2026-11-12?edition=noon')).status()).toBe(404);
	});
});

test.describe('academy', () => {
	test('all 30 lesson routes load, and a day outside its week is 404', async ({ request }) => {
		const weekOf = (day: number) => (day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4);
		for (let day = 1; day <= 30; day++) {
			const response = await request.get(`/academy/week/${weekOf(day)}/day/${day}`);
			expect(response.status(), `day ${day}`).toBe(200);
		}
		expect((await request.get('/academy/week/2/day/1')).status()).toBe(404);
	});

	test('lesson mark-complete persists across a reload', async ({ page }) => {
		await page.goto('/academy/week/1/day/2');
		const button = page.getByTestId('mark-complete');
		await expect(button).toHaveAttribute('aria-pressed', 'false');
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');

		await page.reload();
		await expect(page.getByTestId('mark-complete')).toHaveAttribute('aria-pressed', 'true');
		await page.goto('/academy?week=1');
		await expect(page.getByTestId('academy-progress')).toContainText('1');
		await expect(
			page.locator('a[data-testid="lesson-card"][href="/academy/week/1/day/2"]')
		).toHaveAttribute('data-completed', 'true');
	});

	test('unverified further reading is plain text, not a link', async ({ page }) => {
		await page.goto('/academy/week/1/day/1');
		const unverified = page.locator(
			'section[aria-labelledby="further-reading"] li[data-unverified="true"]'
		);
		await expect(unverified.first()).toBeVisible();
		await expect(unverified.locator('a')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'สารบัญ' })).toBeAttached();
	});
});

test('connections list relations with evidence links', async ({ page }) => {
	await page.goto('/connections');
	const items = page.getByTestId('connection-list').locator('li');
	await expect(items.first()).toBeVisible();
	await expect(items.first().locator('a[rel~="external"]').first()).toBeVisible();
	await page.getByTestId('chip-technology').click();
	await expect(page).toHaveURL(/category=technology/);
});

test('every page sets a title, description and og:url', async ({ page }) => {
	for (const route of MAIN_ROUTES) {
		await page.goto(route);
		await expect(page).toHaveTitle(/Worldview/);
		await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			/^https?:\/\//
		);
	}
});
