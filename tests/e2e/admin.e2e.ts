import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, signAccessToken } from './admin-auth';

/**
 * Admin area against the production build (see admin-e2e-server.ts): real RS256 verification
 * against the test JWKS, SvelteKit's CSRF origin check, and the publish → public flow on the
 * seeded demo data (demo-evt-13 starts in pending_review).
 */
test.describe.configure({ mode: 'serial' });

const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };

async function useAdminToken(page: Page) {
	await page.setExtraHTTPHeaders({ [ACCESS_HEADER]: await signAccessToken() });
}

async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('access control', () => {
	test('/admin without a token is 403 (GET and POST), with no-store and no details', async ({
		request
	}) => {
		for (const path of ['/admin', '/admin/review', '/admin/events/demo-evt-13']) {
			const response = await request.get(path);
			expect(response.status(), path).toBe(403);
			expect(response.headers()['cache-control']).toContain('no-store');
			const body = await response.text();
			expect(body).toContain('ไม่มีสิทธิ์เข้าถึง');
			expect(body).not.toMatch(/jwt|aud|token/i);
		}

		const post = await request.post('/admin/review?/publish', {
			form: { id: 'demo-evt-13', change_reason: 'ไม่มีสิทธิ์' }
		});
		expect(post.status()).toBe(403);
	});

	test('a token for another audience or email is 403', async ({ request }) => {
		for (const token of [
			await signAccessToken({ audience: 'another-app' }),
			await signAccessToken({ email: 'intruder@example.com' })
		]) {
			const response = await request.get('/admin', { headers: { [ACCESS_HEADER]: token } });
			expect(response.status()).toBe(403);
		}
	});

	test('a cross-origin form POST to an admin action is rejected by the CSRF check', async ({
		request
	}) => {
		const response = await request.post('/admin/review?/hide', {
			headers: {
				[ACCESS_HEADER]: await signAccessToken(),
				origin: 'https://evil.example.com'
			},
			form: { id: 'demo-evt-01', change_reason: 'ข้ามโดเมน' }
		});
		expect(response.status()).toBe(403);
		expect(await response.text()).toContain('Cross-site POST form submissions are forbidden');
		expect((await request.get('/events/demo-evt-01')).status()).toBe(200);
	});

	test('the production build contains no dev bypass', () => {
		const files = ['build', '.svelte-kit/output/server'].flatMap((dir) => listFiles(dir));
		expect(files.length).toBeGreaterThan(0);
		const leaking = files.filter((file) => readFileSync(file, 'utf8').includes('dev@localhost'));
		expect(leaking).toEqual([]);
	});

	test('the client bundle never mentions the admin auth variables', () => {
		const files = listFiles('build/client');
		expect(files.length).toBeGreaterThan(0);
		const pattern = /CF_ACCESS_|ADMIN_ALLOWED_EMAILS/;
		expect(files.filter((file) => pattern.test(readFileSync(file, 'utf8')))).toEqual([]);
	});
});

test.describe('with a valid Cloudflare Access token', () => {
	test.beforeEach(async ({ page }) => useAdminToken(page));

	test('the dashboard renders', async ({ page }) => {
		const response = await page.goto('/admin');
		expect(response?.status()).toBe(200);
		expect(response?.headers()['cache-control']).toContain('no-store');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('ภาพรวมระบบ');
		await expect(page.getByTestId('admin-email')).toContainText(E2E_ADMIN_EMAIL);
		await expect(page.getByTestId('review-backlog')).toContainText('เหตุการณ์ 1');
		await expect(page.getByTestId('llm-usage')).toBeVisible();
		await expect(page.getByTestId('source-health')).toBeVisible();
		await expect(page.getByTestId('dev-bypass-banner')).toHaveCount(0);
	});

	test('publishing from the review queue makes the event public', async ({ page }) => {
		expect((await page.request.get('/events/demo-evt-13')).status()).toBe(404);

		await page.goto('/admin/review');
		const card = page.locator('[data-testid="review-event"][data-id="demo-evt-13"]');
		await expect(card).toContainText('ประเด็นอ่อนไหวที่มีแหล่งข่าวเดียว');
		await card.getByLabel('เหตุผล (จำเป็น)').fill('ตรวจแหล่งข่าวแล้ว');
		await card.getByRole('button', { name: 'เผยแพร่' }).click();

		await expect(page.getByTestId('action-notice')).toContainText('เผยแพร่แล้ว');
		await expect(page.locator('[data-id="demo-evt-13"]')).toHaveCount(0);

		const publicPage = await page.goto('/events/demo-evt-13');
		expect(publicPage?.status()).toBe(200);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('รายงานการปะทะ');
	});

	test('a hidden event 404s publicly', async ({ page }) => {
		await page.goto('/admin/events/demo-evt-13');
		await expect(page.getByTestId('revisions')).toContainText('ตรวจแหล่งข่าวแล้ว');
		await page.locator('#status-reason').fill('ซ่อนเพื่อทดสอบ');
		await page.getByRole('button', { name: 'ซ่อน', exact: true }).click();
		await expect(page.getByTestId('event-status')).toHaveText('ซ่อนอยู่');

		const publicPage = await page.goto('/events/demo-evt-13');
		expect(publicPage?.status()).toBe(404);
	});

	test('edit validation rejects URLs and keeps the input', async ({ page }) => {
		await page.goto('/admin/events/demo-evt-01');
		const form = page.getByTestId('edit-form');
		await form.getByLabel('หัวข้อ').fill('อ่านต่อที่ https://evil.example.com');
		await form.getByLabel('เหตุผลของการแก้ไข').fill('ทดสอบการตรวจ');
		await form.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();

		await expect(page.getByTestId('action-notice')).toContainText('บันทึกไม่ได้');
		await expect(form.getByLabel('หัวข้อ')).toHaveValue('อ่านต่อที่ https://evil.example.com');
		expect((await page.request.get('/events/demo-evt-01')).status()).toBe(200);
	});

	test('jobs page offers every job, and a brief before its window closes is refused', async ({
		page
	}) => {
		await page.goto('/admin/jobs');
		for (const job of ['ingest', 'digest', 'brief_morning', 'brief_evening', 'archive_snapshot']) {
			await expect(page.getByTestId(`rerun-${job}`)).toBeVisible();
		}
		await expect(page.getByTestId('rerun-ingest').locator('input[name="date"]')).toHaveCount(0);

		// A future date: the window is open, so nothing is claimed and the real reason is shown.
		const form = page.getByTestId('rerun-brief_evening');
		await form.locator('input[name="date"]').fill('2099-01-01');
		await form.getByLabel('เหตุผล (จำเป็น)').fill('ทดสอบสร้างล่วงหน้า');
		await form.getByRole('button', { name: 'รันตอนนี้' }).click();

		await expect(page.getByTestId('action-notice')).toContainText('ยังไม่ปิด');
		await expect(page.getByTestId('brief_evening-state')).toHaveText('พร้อมสั่งรัน');
	});

	for (const viewport of [MOBILE, DESKTOP]) {
		test(`admin pages have no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
			await page.setViewportSize(viewport);
			for (const path of [
				'/admin',
				'/admin/review',
				'/admin/events/demo-evt-01',
				'/admin/relations',
				'/admin/briefs',
				'/admin/jobs'
			]) {
				const response = await page.goto(path);
				expect(response?.status(), path).toBe(200);
				await expect(page.locator('h1').first()).toBeVisible();
				await expectNoHorizontalOverflow(page);
			}
		});
	}
});

test('every response carries the security headers', async ({ request }) => {
	const response = await request.get('/');
	const headers = response.headers();
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['permissions-policy']).toContain('camera=()');
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
});

function listFiles(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? listFiles(path) : path.endsWith('.js') ? [path] : [];
	});
}
