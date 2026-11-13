import { expect, test } from '@playwright/test';
import { KNOWN_A11Y_BUGS, nodesOf, scanPage, unexpectedSerious } from './a11y-helpers';
import { PUBLIC_ROUTES, THEMES } from './qa-helpers';

/**
 * axe-core on the main public routes in both themes (PRD §8.1 "Accessible"). New serious or
 * critical violations fail; known ones are BUG-QA-001…004 (docs/qa/BUGS.md) with a fixme each.
 */
const ROUTES = [...PUBLIC_ROUTES, '/search', '/no-such-page'];

for (const colorScheme of THEMES) {
	test.describe(`axe (${colorScheme})`, () => {
		test.use({ colorScheme });

		for (const route of ROUTES) {
			test(`${route} has no new serious or critical violations`, async ({ page }, testInfo) => {
				await page.goto(route);
				await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
				const nodes = await scanPage(page, testInfo, `${route} ${colorScheme}`);
				expect(unexpectedSerious(nodes)).toEqual([]);
			});
		}
	});
}

test.describe('known accessibility bugs', () => {
	test.fixme('BUG-QA-001: the logo link name contains its visible text', async ({
		page
	}, testInfo) => {
		await page.goto('/');
		expect(nodesOf(await scanPage(page, testInfo, '/'), KNOWN_A11Y_BUGS.logoLabel)).toEqual([]);
	});

	test.fixme('BUG-QA-002: archive calendar days without a brief meet 4.5:1 contrast', async ({
		page
	}, testInfo) => {
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await page.goto('/archive?month=2026-11');
			const nodes = await scanPage(page, testInfo, `/archive ${colorScheme}`);
			expect(nodesOf(nodes, KNOWN_A11Y_BUGS.calendarContrast)).toEqual([]);
		}
	});

	test.fixme('BUG-QA-003: text-faint meets 4.5:1 contrast in the light theme', async ({
		page
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: 'light' });
		for (const route of ['/academy/week/1/day/1', '/connections']) {
			await page.goto(route);
			const nodes = await scanPage(page, testInfo, route);
			expect(nodesOf(nodes, KNOWN_A11Y_BUGS.faintTextContrast)).toEqual([]);
		}
	});

	test.fixme('BUG-QA-004: the event facts <dl> only contains dt/dd groups', async ({
		page
	}, testInfo) => {
		await page.goto('/events/demo-evt-01');
		const nodes = await scanPage(page, testInfo, '/events/demo-evt-01');
		expect(nodesOf(nodes, KNOWN_A11Y_BUGS.eventFactsList)).toEqual([]);
	});
});
