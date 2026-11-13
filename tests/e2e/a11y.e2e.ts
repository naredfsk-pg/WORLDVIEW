import { expect, test } from '@playwright/test';
import { nodesOf, scanPage, unexpectedSerious, type KnownA11yBug } from './a11y-helpers';
import { PUBLIC_ROUTES, THEMES } from './qa-helpers';

/**
 * axe-core on the main public routes in both themes (PRD §8.1 "Accessible"). Serious or critical
 * violations fail. BUG-QA-001…004 and 008 (docs/qa/BUGS.md) were fixed in Wave 3; the regression
 * block below keeps their specific checks.
 */
const ROUTES = [...PUBLIC_ROUTES, '/search', '/no-such-page'];

/** An empty `html` matches every node of the rule. */
const FIXED_A11Y_BUGS = {
	logoLabel: { id: 'BUG-QA-001', rule: 'label-content-name-mismatch', html: '' },
	calendarContrast: { id: 'BUG-QA-002', rule: 'color-contrast', html: '' },
	faintTextContrast: { id: 'BUG-QA-003', rule: 'color-contrast', html: 'text-faint' },
	eventFactsList: { id: 'BUG-QA-004', rule: 'definition-list', html: '' },
	briefHeadingOrder: { id: 'BUG-QA-008', rule: 'heading-order', html: '' }
} as const satisfies Record<string, KnownA11yBug>;

for (const colorScheme of THEMES) {
	test.describe(`axe (${colorScheme})`, () => {
		test.use({ colorScheme });

		for (const route of ROUTES) {
			test(`${route} has no serious or critical violations`, async ({ page }, testInfo) => {
				await page.goto(route);
				await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
				const nodes = await scanPage(page, testInfo, `${route} ${colorScheme}`);
				expect(unexpectedSerious(nodes)).toEqual([]);
			});
		}
	});
}

test.describe('fixed accessibility bugs (regression)', () => {
	test('BUG-QA-001: the logo link name contains its visible text', async ({ page }, testInfo) => {
		await page.goto('/');
		expect(nodesOf(await scanPage(page, testInfo, '/'), FIXED_A11Y_BUGS.logoLabel)).toEqual([]);
	});

	test('BUG-QA-002: archive calendar days without a brief meet 4.5:1 contrast', async ({
		page
	}, testInfo) => {
		for (const colorScheme of THEMES) {
			await page.emulateMedia({ colorScheme });
			await page.goto('/archive?month=2026-11');
			const nodes = await scanPage(page, testInfo, `/archive ${colorScheme}`);
			expect(nodesOf(nodes, FIXED_A11Y_BUGS.calendarContrast), colorScheme).toEqual([]);
		}
	});

	test('BUG-QA-003: text-faint meets 4.5:1 contrast in both themes', async ({ page }, testInfo) => {
		for (const colorScheme of THEMES) {
			await page.emulateMedia({ colorScheme });
			for (const route of ['/academy/week/1/day/1', '/connections', '/', '/archive']) {
				await page.goto(route);
				const nodes = await scanPage(page, testInfo, `${route} ${colorScheme}`);
				expect(nodesOf(nodes, FIXED_A11Y_BUGS.faintTextContrast), route).toEqual([]);
			}
		}
	});

	test('BUG-QA-004: the event facts <dl> only contains dt/dd groups', async ({
		page
	}, testInfo) => {
		await page.goto('/events/demo-evt-01');
		const nodes = await scanPage(page, testInfo, '/events/demo-evt-01');
		expect(nodesOf(nodes, FIXED_A11Y_BUGS.eventFactsList)).toEqual([]);
		await expect(page.getByText('เวลาทั้งหมดเป็นเวลาไทย (GMT+7)')).toBeVisible();
	});

	test('BUG-QA-008: the brief page does not skip a heading level', async ({ page }, testInfo) => {
		await page.goto('/brief/2026-11-12');
		const nodes = await scanPage(page, testInfo, '/brief/2026-11-12');
		expect(nodesOf(nodes, FIXED_A11Y_BUGS.briefHeadingOrder)).toEqual([]);
	});
});
