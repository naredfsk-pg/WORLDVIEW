import { expect, test, type Locator } from '@playwright/test';
import { eventPathsIn, openE2eDbReadOnly } from './qa-helpers';

/**
 * PRD §11 #7 (citations) and #8 (relations) over ALL public content of the seeded e2e database,
 * not a sample: the expected sets come straight from SQLite, the observed ones from the pages.
 * Runs in the public project, before the admin suite changes any status.
 *
 * The database is read in `beforeAll`, not at module load: playwright loads spec files before the
 * webServer resets `data/e2e.db`. Each test loops over every row with `expect.soft`, so one run
 * reports every failing event.
 */
interface SeededContent {
	publicEvents: string[];
	nonPublicEvents: string[];
	storedArticleUrls: Set<string>;
	publishedBriefs: { date: string; edition: string }[];
}

let seeded: SeededContent;

test.beforeAll(() => {
	const db = openE2eDbReadOnly();
	try {
		const events = db.prepare('SELECT id, status, category FROM events ORDER BY id').all() as {
			id: string;
			status: string;
			category: string | null;
		}[];
		const isPublic = (row: (typeof events)[number]) =>
			row.status === 'published' && row.category !== null;
		seeded = {
			publicEvents: events.filter(isPublic).map((row) => row.id),
			nonPublicEvents: events.filter((row) => !isPublic(row)).map((row) => row.id),
			storedArticleUrls: new Set(
				(db.prepare('SELECT canonical_url AS url FROM articles').all() as { url: string }[]).map(
					(row) => row.url
				)
			),
			publishedBriefs: db
				.prepare(
					"SELECT brief_date AS date, edition FROM daily_briefs WHERE status = 'published' ORDER BY brief_date, edition"
				)
				.all() as { date: string; edition: string }[]
		};
	} finally {
		db.close();
	}
});

test.describe('acceptance #7: every public event cites its original sources', () => {
	test('each public event shows >= 1 source, and every external link is a stored article URL', async ({
		page
	}) => {
		expect(seeded.publicEvents.length).toBeGreaterThan(0);
		for (const id of seeded.publicEvents) {
			const response = await page.goto(`/events/${id}`);
			expect.soft(response?.status(), id).toBe(200);

			const sourceLinks = page.locator('section[aria-labelledby="sources"] a[href^="http"]');
			expect.soft(await sourceLinks.count(), `${id} source links`).toBeGreaterThanOrEqual(1);
			for (const rel of await attributeOf(sourceLinks, 'rel')) {
				expect.soft(rel, `${id} source rel`).toContain('noopener');
			}
			for (const href of await attributeOf(page.locator('main a[href^="http"]'), 'href')) {
				expect.soft(seeded.storedArticleUrls.has(href), `${id}: invented link ${href}`).toBe(true);
			}
		}
	});

	test('every non-public event (draft, pending_review, hidden) is a 404', async ({ request }) => {
		expect(seeded.nonPublicEvents.length).toBeGreaterThan(0);
		for (const id of seeded.nonPublicEvents) {
			expect.soft((await request.get(`/events/${id}`)).status(), id).toBe(404);
		}
	});

	test('every event linked from a published brief is public', async ({ page, request }) => {
		expect(seeded.publishedBriefs.length).toBeGreaterThan(0);
		for (const { date, edition } of seeded.publishedBriefs) {
			const response = await page.goto(`/brief/${date}?edition=${edition}`);
			expect.soft(response?.status(), `${date} ${edition}`).toBe(200);
			const paths = await eventPathsIn(page.locator('main'));
			expect.soft(paths.length, `${date} ${edition} has events`).toBeGreaterThan(0);
			for (const path of new Set(paths)) {
				expect.soft((await request.get(path)).status(), path).toBe(200);
			}
		}
	});
});

test.describe('acceptance #8: every public relation has a type, an explanation and evidence', () => {
	test('/connections: each relation shows all three, with stored evidence URLs', async ({
		page
	}) => {
		await page.goto('/connections');
		const relations = page.getByTestId('connection-list').locator('li[data-relation-type]');
		expect(await relations.count()).toBeGreaterThan(0);
		await expectRelationsWellFormed(relations, '/connections');
	});

	test('every related-event card on every public event page is well formed', async ({ page }) => {
		let checked = 0;
		for (const id of seeded.publicEvents) {
			await page.goto(`/events/${id}`);
			const relations = page.locator('li[data-relation-type]');
			checked += await relations.count();
			await expectRelationsWellFormed(relations, id);
		}
		expect(checked).toBeGreaterThan(0);
	});
});

async function expectRelationsWellFormed(relations: Locator, where: string): Promise<void> {
	for (const relation of await relations.all()) {
		const type = await relation.getAttribute('data-relation-type');
		expect.soft(type, where).toBeTruthy();
		const explanation = (await relation.locator('p', { hasText: 'ทำไมจึงเชื่อมโยง:' }).innerText())
			.replace('ทำไมจึงเชื่อมโยง:', '')
			.trim();
		expect.soft(explanation.length, `${where} ${type}: explanation`).toBeGreaterThan(0);

		const evidence = await attributeOf(
			relation.getByTestId('evidence-links').locator('a[href^="http"]'),
			'href'
		);
		expect.soft(evidence.length, `${where} ${type}: evidence`).toBeGreaterThanOrEqual(1);
		for (const href of evidence) {
			expect.soft(seeded.storedArticleUrls.has(href), `${where}: ${href}`).toBe(true);
		}
	}
}

function attributeOf(locator: Locator, name: string): Promise<string[]> {
	return locator.evaluateAll(
		(nodes, attribute) => nodes.map((node) => node.getAttribute(attribute) ?? ''),
		name
	);
}
