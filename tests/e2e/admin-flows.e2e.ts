import { expect, test } from '@playwright/test';
import { useAdminToken } from './qa-helpers';

/**
 * Admin flows not covered by admin.e2e.ts: the optimistic-concurrency 409 when two editors save
 * the same event, the review → publish → public flow driven by keyboard only, and the
 * credibility fields of the edit form (read only, demo-evt-04). Uses events that admin.e2e.ts
 * does not touch (demo-evt-02 is edited; demo-evt-13 belongs to admin.e2e.ts).
 */
const EVENT = 'demo-evt-02';
const CONFLICT_TEXT = 'มีการแก้ไขจากระบบหรือผู้อื่นหลังจากคุณเปิดหน้านี้';

test('a second editor saving a stale form gets the 409 conflict and keeps their input', async ({
	browser
}) => {
	const first = await browser.newPage();
	const second = await browser.newPage();
	await useAdminToken(first);
	await useAdminToken(second);
	await first.goto(`/admin/events/${EVENT}`);
	await second.goto(`/admin/events/${EVENT}`);

	const firstForm = first.getByTestId('edit-form');
	await firstForm.getByLabel('หัวข้อ').fill('หัวข้อจากผู้แก้ไขคนแรก');
	await firstForm.getByLabel('เหตุผลของการแก้ไข').fill('ทดสอบการแก้ไขพร้อมกัน');
	await firstForm.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
	await expect(first.getByTestId('action-notice')).toContainText('บันทึกการแก้ไขแล้ว');

	const secondForm = second.getByTestId('edit-form');
	await secondForm.getByLabel('หัวข้อ').fill('หัวข้อจากผู้แก้ไขคนที่สอง');
	await secondForm.getByLabel('เหตุผลของการแก้ไข').fill('ทดสอบการแก้ไขพร้อมกัน');
	const [response] = await Promise.all([
		second.waitForResponse((res) => res.request().method() === 'POST'),
		secondForm.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
	]);
	expect(response.status()).toBe(409);
	await expect(second.getByTestId('action-notice')).toContainText(CONFLICT_TEXT);
	await expect(secondForm.getByLabel('หัวข้อ')).toHaveValue('หัวข้อจากผู้แก้ไขคนที่สอง');

	// The first save won; the stale one changed nothing.
	await first.goto(`/events/${EVENT}`);
	await expect(first.getByRole('heading', { level: 1 })).toHaveText('หัวข้อจากผู้แก้ไขคนแรก');
	await first.close();
	await second.close();
});

test('the review queue and the edit form are usable with the keyboard only', async ({ page }) => {
	await useAdminToken(page);
	await page.goto(`/admin/events/${EVENT}`);
	const reason = page.getByTestId('edit-form').getByLabel('เหตุผลของการแก้ไข');
	await reason.focus();
	await page.keyboard.type('ใช้แป้นพิมพ์อย่างเดียว');
	// Tab moves on to the submit button eventually, without a mouse.
	let reachedSubmit = false;
	for (let step = 0; step < 15 && !reachedSubmit; step++) {
		await page.keyboard.press('Tab');
		reachedSubmit = await page.evaluate(
			() => document.activeElement?.textContent?.trim() === 'บันทึกการแก้ไข'
		);
	}
	expect(reachedSubmit).toBe(true);
	const focusVisible = await page.evaluate(() => {
		const style = getComputedStyle(document.activeElement as Element);
		return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
	});
	expect(focusVisible).toBe(true);
});

test('the edit form shows the current credibility label and offers every level', async ({
	page
}) => {
	await useAdminToken(page);
	await page.goto('/admin/events/demo-evt-04');
	await expect(page.getByTestId('event-credibility')).toContainText('ข้อมูลขัดแย้งกัน');

	const form = page.getByTestId('edit-form');
	const select = form.getByLabel('ระดับป้าย');
	await expect(select).toHaveValue('disputed');
	await expect(select.locator('option')).toHaveText([
		'ไม่มีป้าย',
		'ยังไม่ได้รับการยืนยัน',
		'ข้อมูลขัดแย้งกัน',
		'อาจเป็นข้อมูลเท็จ'
	]);
	await expect(form.getByLabel('เหตุผลของป้าย')).toHaveAttribute('maxlength', '300');
	// Optimistic concurrency: the loaded values travel with the form.
	await expect(form.locator('input[name="original_credibility_level"]')).toHaveValue('disputed');
	await expect(form.locator('input[name="original_credibility_reason_th"]')).not.toHaveValue('');
});

test('an admin override of the credibility label is saved and shown publicly', async ({ page }) => {
	// demo-evt-09 is not asserted by any other spec.
	await useAdminToken(page);
	await page.goto('/admin/events/demo-evt-09');
	const form = page.getByTestId('edit-form');
	await form.getByLabel('ระดับป้าย').selectOption('possible_misinformation');
	await form.getByLabel('เหตุผลของป้าย').fill('มีรายงานว่าภาพที่แพร่กระจายเป็นภาพเก่า (ข้อมูลตัวอย่าง)');
	await form.getByLabel('เหตุผลของการแก้ไข').fill('ตั้งป้ายความน่าเชื่อถือ');
	await form.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
	await expect(page.getByTestId('action-notice')).toContainText('บันทึกการแก้ไขแล้ว');
	await expect(page.getByTestId('event-credibility')).toContainText('อาจเป็นข้อมูลเท็จ');

	await page.goto('/events/demo-evt-09');
	const label = page.getByTestId('credibility-label').first();
	await expect(label).toHaveAttribute('data-level', 'possible_misinformation');
	await expect(label).toHaveText('อาจเป็นข้อมูลเท็จ');
	await expect(page.getByTestId('credibility-reason')).toContainText('ภาพที่แพร่กระจายเป็นภาพเก่า');
});
