/**
 * Shared fixtures for the acceptance suite (docs/qa/ACCEPTANCE.md). Not a spec: playwright only
 * runs `*.e2e.ts`.
 */
import Database from 'better-sqlite3';
import { expect, type Locator, type Page } from '@playwright/test';
import { E2E_DATABASE_URL, signAccessToken } from './admin-auth';

/** UI_DESIGN_SPEC §8 screen checklist widths. */
export const SPEC_WIDTHS = [360, 390, 430, 768, 1024, 1440] as const;
export const THEMES = ['light', 'dark'] as const;

/** Main public routes on the seeded demo data (`npm run db:reset`). */
export const PUBLIC_ROUTES = [
	'/',
	'/academy',
	'/academy/week/1/day/1',
	'/academy/week/4/day/30',
	'/archive',
	'/brief/2026-11-12',
	'/connections',
	'/events/demo-evt-01',
	// Carries a credibility label with its reason and explainer.
	'/events/demo-evt-04',
	'/search?q=AI'
] as const;

export const ADMIN_ROUTES = [
	'/admin',
	'/admin/review',
	'/admin/events/demo-evt-01',
	'/admin/relations',
	'/admin/briefs',
	'/admin/jobs'
] as const;

export async function useAdminToken(page: Page): Promise<void> {
	await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': await signAccessToken() });
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

/** Resolved `/events/…` paths: the server renders relative hrefs ("../events/…") until hydration. */
export function eventPathsIn(scope: Locator): Promise<string[]> {
	return scope
		.locator('a[href*="events/"]')
		.evaluateAll((nodes) =>
			nodes
				.map((node) => new URL((node as HTMLAnchorElement).href).pathname)
				.filter((path) => path.startsWith('/events/'))
		);
}

/** Read-only handle on the e2e database the preview server is using. */
export function openE2eDbReadOnly(): Database.Database {
	return new Database(E2E_DATABASE_URL.replace(/^file:/, ''), {
		readonly: true,
		fileMustExist: true
	});
}
