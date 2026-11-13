import { expect, test, type Page } from '@playwright/test';

/**
 * Reproductions of the two Lighthouse mobile findings in docs/qa/BASELINE.md, so that they can
 * be checked without Lighthouse. Both were fixed in Wave 3 (docs/qa/BUGS.md). The
 * thresholds are Lighthouse's own pass marks (CLS "good" < 0.1; legible text >= 60 %), not new
 * performance targets.
 */
const MOBILE = { width: 412, height: 823 };

test.describe('Lighthouse mobile findings', () => {
	test.use({ viewport: MOBILE });

	test('BUG-QA-009: at least 60 % of the text is 12 px or larger', async ({ page }) => {
		for (const route of ['/', '/archive', '/events/demo-evt-01']) {
			await page.goto(route);
			expect.soft(await legibleTextShare(page), route).toBeGreaterThanOrEqual(0.6);
		}
	});

	test('BUG-QA-010: /archive has CLS < 0.1 on a throttled mobile load', async ({ page }) => {
		expect(await throttledCls(page, '/archive')).toBeLessThan(0.1);
	});
});

/** Share of visible text characters whose computed font size is >= 12 px (Lighthouse `font-size`). */
function legibleTextShare(page: Page): Promise<number> {
	return page.evaluate(() => {
		let legible = 0;
		let total = 0;
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const parent = node.parentElement;
			const length = node.textContent?.trim().length ?? 0;
			if (!parent || length === 0 || parent.closest('script, style, .sr-only')) continue;
			const style = getComputedStyle(parent);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			total += length;
			if (parseFloat(style.fontSize) >= 12) legible += length;
		}
		return total === 0 ? 1 : legible / total;
	});
}

/** Layout-shift sum of one load under Lighthouse's mobile throttling (slow 4G, 4x CPU). */
async function throttledCls(page: Page, route: string): Promise<number> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.emulateNetworkConditions', {
		offline: false,
		latency: 562,
		downloadThroughput: (1474 * 1024) / 8,
		uploadThroughput: (675 * 1024) / 8
	});
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	await page.addInitScript(() => {
		const state = window as unknown as { __cls: number };
		state.__cls = 0;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as (PerformanceEntry & {
				value: number;
				hadRecentInput: boolean;
			})[]) {
				if (!entry.hadRecentInput) state.__cls += entry.value;
			}
		}).observe({ type: 'layout-shift', buffered: true });
	});
	await page.goto(route, { waitUntil: 'networkidle', timeout: 60_000 });
	await page.waitForTimeout(2000);
	return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}
