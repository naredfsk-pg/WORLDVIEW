import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { E2E_DATABASE_URL } from './admin-auth';
import { eventPathsIn, openE2eDbReadOnly, useAdminToken } from './qa-helpers';

/**
 * PRD §11 #3, #4, #6 and #11 end to end: the fixture pipeline (tests/pipeline/
 * run-fixture-pipeline.ts: ingest fixture feeds → digest with the mock LLM → briefs → archive
 * snapshot → forced rerun) writes into the e2e database the preview server reads, then the public
 * and admin pages are checked. Runs last (playwright project `pipeline`, after `admin`).
 */
test.describe.configure({ mode: 'serial' });

interface PipelineSummary {
	brief_date: string;
	steps: Record<string, { status: string; duration_ms: number }>;
	counts_before_rerun: Record<string, number>;
	counts_after_rerun: Record<string, number>;
	peak_rss_bytes: number;
}

let summary: PipelineSummary;
let kessel: { eventId: string; urls: string[] };

test.beforeAll(() => {
	const run = spawnSync('npx tsx tests/pipeline/run-fixture-pipeline.ts', {
		shell: true,
		encoding: 'utf8',
		env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL }
	});
	if (run.status !== 0) throw new Error(`fixture pipeline failed:\n${run.stderr}\n${run.stdout}`);
	const lastLine = run.stdout.trim().split('\n').at(-1) ?? '';
	summary = (JSON.parse(lastLine) as { pipeline_summary: PipelineSummary }).pipeline_summary;
	kessel = findKesselEvent();
});

test('#4: every step ran, and a forced second ingest + digest adds no rows', () => {
	for (const [name, step] of Object.entries(summary.steps)) {
		expect(step.status, name).toBe(name === 'brief_empty_day' ? 'partial' : 'succeeded');
	}
	expect(summary.counts_after_rerun).toEqual(summary.counts_before_rerun);
});

test('#3: the three fixture reports of one story are one public event with three sources', async ({
	page
}) => {
	expect(kessel.urls).toHaveLength(3);
	const response = await page.goto(`/events/${kessel.eventId}`);
	expect(response?.status()).toBe(200);
	const hrefs = await page
		.locator('section[aria-labelledby="sources"] a[href^="http"]')
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
	expect(hrefs.sort()).toEqual([...kessel.urls].sort());
});

test('#6: the morning and evening briefs and the archive show the new event', async ({ page }) => {
	const eventPath = `/events/${kessel.eventId}`;
	for (const edition of ['morning', 'evening', 'daily_snapshot']) {
		const response = await page.goto(`/brief/${summary.brief_date}?edition=${edition}`);
		expect(response?.status(), edition).toBe(200);
		expect(await eventPathsIn(page.locator('main')), edition).toContain(eventPath);
	}
	await page.goto(`/archive?date=${summary.brief_date}`);
	expect(await eventPathsIn(page.locator('main'))).toContain(eventPath);
});

test('#11: job status, last sync and the stored error are visible', async ({ page, request }) => {
	const health = await (await request.get('/health')).json();
	expect(health).toMatchObject({ status: 'ok', db: 'ok', stale: false });
	expect(Date.now() - Date.parse(health.last_ingest_succeeded_at)).toBeLessThan(10 * 60_000);

	await useAdminToken(page);
	await page.goto('/admin/jobs');
	const runs = page.getByTestId('job-runs');
	await expect(runs).toContainText('ingest:fixtures:');
	await expect(runs).toContainText(`brief_evening:${summary.brief_date}`);
	await expect(runs).toContainText(`archive_snapshot:${summary.brief_date}`);
	await expect(runs).toContainText('ข้อผิดพลาด: 0 events, below DAILY_EVENT_TARGET_MIN 1');
});

/** The fixture story told by wire A, B and C ("Kessel River" accord). */
function findKesselEvent(): { eventId: string; urls: string[] } {
	const db = openE2eDbReadOnly();
	try {
		const rows = db
			.prepare(
				`SELECT ea.event_id AS eventId, a.canonical_url AS url
				 FROM event_articles ea JOIN articles a ON a.id = ea.article_id
				 WHERE a.canonical_url LIKE 'https://fixtures.worldview.invalid/%'
				   AND a.title LIKE '%Kessel%'`
			)
			.all() as { eventId: string; url: string }[];
		const eventIds = [...new Set(rows.map((row) => row.eventId))];
		if (eventIds.length !== 1) {
			throw new Error(`expected one Kessel event, found ${eventIds.length}`);
		}
		return { eventId: eventIds[0]!, urls: rows.map((row) => row.url) };
	} finally {
		db.close();
	}
}
