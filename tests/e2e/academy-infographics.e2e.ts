import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { scanPage, unexpectedSerious } from './a11y-helpers';
import { expectNoHorizontalOverflow, THEMES } from './qa-helpers';

/**
 * Academy infographics (owner request 2026-11-13): the 30-second summary, the diagrams and the
 * folded reading path. These lessons cover every infographic type between them:
 * day 1 hub + compare · day 4 timeline + hub · day 6 compare (3 columns) + stats ·
 * day 9 compare + cycle · day 12 pyramid · day 14 stack + flow.
 *
 * `ACADEMY_SCREENSHOTS=1` also saves the screenshots in docs/qa/screenshots/academy-infographics.
 */
const LESSONS = [
	{ path: '/academy/week/1/day/1', types: ['hub', 'compare'] },
	{ path: '/academy/week/1/day/4', types: ['timeline', 'hub'] },
	{ path: '/academy/week/1/day/6', types: ['compare', 'stats'] },
	{ path: '/academy/week/2/day/9', types: ['compare', 'cycle'] },
	{ path: '/academy/week/2/day/12', types: ['layers'] },
	{ path: '/academy/week/2/day/14', types: ['layers', 'flow'] }
];
const WIDTHS = [320, 768, 1280] as const;
const SCREENSHOT_DIR = 'docs/qa/screenshots/academy-infographics';
/** Committed screenshots: one lesson per main diagram family, kept to 12 small PNGs. */
const SCREENSHOT_LESSONS = new Set([
	'/academy/week/1/day/1',
	'/academy/week/1/day/4',
	'/academy/week/2/day/9',
	'/academy/week/2/day/12'
]);

for (const width of WIDTHS) {
	for (const colorScheme of THEMES) {
		test.describe(`lesson infographics at ${width}px (${colorScheme})`, () => {
			test.use({ viewport: { width, height: 900 }, colorScheme });

			for (const lesson of LESSONS) {
				test(`${lesson.path} shows the summary and diagrams, fits and passes axe`, async ({
					page
				}, testInfo) => {
					await page.goto(lesson.path);
					await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);

					const takeaways = page.getByTestId('lesson-takeaways');
					await expect(takeaways.getByRole('heading', { name: 'สรุปใน 30 วินาที' })).toBeVisible();
					expect(await takeaways.locator('li').count()).toBeGreaterThanOrEqual(3);

					const figures = page.getByTestId('infographic');
					await expect(figures).toHaveCount(lesson.types.length);
					for (const [index, type] of lesson.types.entries()) {
						const figure = figures.nth(index);
						await expect(figure).toHaveAttribute('data-type', type);
						// Named by its title, described by its caption.
						await expect(figure).toHaveAccessibleName(/.+/);
						await expect(figure).toHaveAccessibleDescription(/.+/);
						await expect(figure.locator('ol, ul').first()).toBeVisible();
					}

					await expectNoHorizontalOverflow(page);
					// Thai text in the diagrams never drops below 14px (metadata excepted).
					const smallest = await figures.evaluateAll((nodes) =>
						Math.min(
							...nodes.flatMap((node) =>
								[...node.querySelectorAll('li span, li p')]
									.filter(
										(element) =>
											element.textContent?.trim() &&
											!element.closest('[aria-hidden="true"]') &&
											!element.classList.contains('text-meta')
									)
									.map((element) => parseFloat(getComputedStyle(element).fontSize))
							)
						)
					);
					expect(smallest).toBeGreaterThanOrEqual(14);

					const nodes = await scanPage(page, testInfo, `${lesson.path} ${width} ${colorScheme}`);
					expect(unexpectedSerious(nodes)).toEqual([]);

					if (process.env.ACADEMY_SCREENSHOTS === '1' && SCREENSHOT_LESSONS.has(lesson.path)) {
						if (width === 768) return;
						if (width === 1280 && colorScheme === 'dark') return;
						mkdirSync(SCREENSHOT_DIR, { recursive: true });
						const name = lesson.path.replace('/academy/week/', 'w').replace('/day/', '-d');
						await hideTabBar(page);
						// From the lesson title to the last diagram: the part this change adds.
						const top = await page.getByTestId('lesson-article').boundingBox();
						const last = await figures.last().boundingBox();
						if (!top || !last) throw new Error('lesson layout not measurable');
						await page.screenshot({
							path: `${SCREENSHOT_DIR}/${name}-${width}-${colorScheme}.png`,
							fullPage: true,
							clip: { x: 0, y: top.y - 16, width, height: last.y + last.height - top.y + 32 }
						});
					}
				});
			}
		});
	}
}

test.describe('folded reading path', () => {
	test('long sections fold behind "อ่านต่อ", and open-all opens them', async ({ page }) => {
		await page.goto('/academy/week/1/day/1');
		const folded = page.locator('.lesson-prose details.lesson-more');
		expect(await folded.count()).toBeGreaterThan(0);
		await expect(folded.first()).not.toHaveAttribute('open');
		await expect(page.locator('.lesson-prose h2').first()).toBeVisible();

		const first = folded.first();
		await first.locator('summary').click();
		await expect(first).toHaveAttribute('open');
		await first.locator('summary').click();
		await expect(first).not.toHaveAttribute('open');

		const toggleAll = page.getByTestId('toggle-all-sections');
		await toggleAll.click();
		await expect(toggleAll).toHaveText('ย่อทุกหัวข้อ');
		await expect(toggleAll).toHaveAttribute('aria-expanded', 'true');
		expect(await page.locator('.lesson-prose details.lesson-more:not([open])').count()).toBe(0);
		await toggleAll.click();
		await expect(toggleAll).toHaveText('เปิดอ่านทุกหัวข้อ');
		await expect(toggleAll).toHaveAttribute('aria-expanded', 'false');
	});

	test('a TOC link into a folded section opens it and scrolls there', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/academy/week/1/day/1');
		const hiddenHeading = page.locator('.lesson-prose details.lesson-more h3').first();
		const id = await hiddenHeading.getAttribute('id');
		expect(id).toBeTruthy();
		await expect(hiddenHeading).toBeHidden();

		await page
			.getByRole('navigation', { name: 'สารบัญ', exact: true })
			.locator(`a[href="#${id}"]`)
			.click();
		await expect(hiddenHeading).toBeVisible();
		await expect(hiddenHeading).toBeInViewport();
	});

	test('a deep link to a folded heading opens it on load', async ({ page }) => {
		await page.goto('/academy/week/1/day/1');
		const id = await page
			.locator('.lesson-prose details.lesson-more h3')
			.first()
			.getAttribute('id');
		// A real document load of the hash URL (not a same-document hash change), from another route.
		await page.goto('/academy');
		await page.goto(`/academy/week/1/day/1#${id}`);
		const target = page.locator(`#${id}`);
		await expect(target).toBeVisible();
		await expect(target).toBeInViewport();
	});
});

test('a hash change to a folded heading opens it and scrolls there', async ({ page }) => {
	await page.goto('/academy/week/1/day/1');
	const heading = page.locator('.lesson-prose details.lesson-more h3').first();
	const id = await heading.getAttribute('id');
	await expect(heading).toBeHidden();
	await page.evaluate((hash) => (location.hash = hash), `#${id}`);
	await expect(heading).toBeVisible();
	await expect(heading).toBeInViewport();
});

test('the Academy roadmap links all 30 days in order', async ({ page }) => {
	await page.goto('/academy');
	const days = page.getByTestId('roadmap-day');
	await expect(days).toHaveCount(30);
	const paths = await days.evaluateAll((nodes) =>
		nodes.map((node) => new URL((node as HTMLAnchorElement).href).pathname)
	);
	expect(paths[0]).toBe('/academy/week/1/day/1');
	expect(paths[29]).toBe('/academy/week/4/day/30');
	await expect(days.first()).toHaveAccessibleName(/วันที่ 1:/);

	if (process.env.ACADEMY_SCREENSHOTS === '1') {
		const roadmap = page.locator('section[aria-labelledby="roadmap-title"]');
		await roadmap.screenshot({ path: `${SCREENSHOT_DIR}/academy-roadmap-1280-light.png` });
		await page.setViewportSize({ width: 320, height: 900 });
		await hideTabBar(page);
		await roadmap.screenshot({ path: `${SCREENSHOT_DIR}/academy-roadmap-320-light.png` });
	}
});

/**
 * The fixed mobile tab bar would cover part of a capture. (Playwright's `style` option injects a
 * <style> element, which the CSP blocks, so hide it through the DOM.)
 */
async function hideTabBar(page: Page): Promise<void> {
	await page
		.locator('.fixed.bottom-0')
		.evaluateAll((nodes) =>
			nodes.forEach((node) => ((node as HTMLElement).style.visibility = 'hidden'))
		);
}
