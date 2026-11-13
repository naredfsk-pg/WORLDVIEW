import { describe, expect, it } from 'vitest';
import { normalizeGeneratedText } from '../../utils/text';
import { containsContact, containsUrl, isThaiText } from './text';

/** Text that must pass both checks: numbers, dates, abbreviations and plain Thai news wording. */
const CLEAN_TEXTS = [
	'สหรัฐฯ (U.S.) ขึ้นดอกเบี้ย 2.5%',
	'เศรษฐกิจโต 3.14 เปอร์เซ็นต์ในไตรมาส 2',
	'ราคาเพิ่มขึ้น เช่น e.g. ค่าขนส่ง',
	'ซอฟต์แวร์รุ่น 1.2.3 ถูกปล่อยแล้ว',
	'เวลา 10.30 น. ตามเวลาไทย',
	'การประชุมเริ่ม 09.30-12.00 น. หรือ 10:30',
	'ธนาคาร J.P. Morgan ระบุว่า',
	'เจ้าหน้าที่ U.S. officials กล่าวว่า',
	'เมื่อวันที่ 13 พ.ย. 2026 (13/11/2026)',
	'รายงานลงวันที่ 2026-11-13 และ 01-11-2026',
	'ระหว่างปี 2020-2025 และ ค.ศ. 1945',
	'ส.ส. ไทย และ ส.ส.ไทย ลงมติ',
	'ดร. สมชาย ให้สัมภาษณ์',
	'งบประมาณ 1,234,567 บาท หรือ 0.5 เปอร์เซ็นต์',
	'ดัชนีเพิ่มขึ้น +2.5% และ +10%',
	'โทรทัศน์ช่อง 3 รายงานว่าโทรศัพท์ 300 เครื่องถูกยึด',
	'ไลน์การผลิตหยุดชั่วคราว ตามแนวหน้า (front line)',
	'iPhone 15 วางจำหน่ายแล้ว',
	'ข่าวภาษาไทยล้วนไม่มีลิงก์ใดๆ',
	'น้ำท่วมหนักในภาคใต้',
	''
];

describe('containsUrl (G3)', () => {
	it.each([
		'อ่านต่อที่ https://news.example.org/a/1',
		'ดู http://x.example',
		'ข้อมูลจาก www.example.com',
		'ดูที่ evil-news.example.com/x',
		'ติดต่อ example.com',
		'แหล่งข่าว NEWS.EXAMPLE.ORG',
		'อีเมล press@agency.example.net',
		'ลิงก์ซ่อนex.co.th/path?q=1',
		// The review probe's obfuscations.
		'ดูที่ evil\u{200B}.com',
		'ดูที่ ev\u{200D}il.com',
		'ดูที่ evil\u{202E}.com',
		'ดูที่ evil\u{FF0E}com',
		'ดูที่ evil\u{3002}com',
		'ดูที่ evil[.]com',
		'ดูที่ evil(.)com',
		'ดูที่ evil(dot)com',
		'ดูที่ evil [dot] com',
		'ดูที่ evil . com',
		'ดูที่ evil .com',
		'ดูที่ evil. com',
		'ดูที่ \u{FF45}\u{FF56}\u{FF49}\u{FF4C}.\u{FF43}\u{FF4F}\u{FF4D}',
		'ดูที่ xn--80ak6aa92e.com',
		'ดูที่ เว็บ.ไทย',
		'ดูที่เว็บข่าวด่วน.ไทย นะ',
		'ดูที่ ร้านค้า.คอม'
	])('flags %s', (text) => {
		expect(containsUrl(text)).toBe(true);
	});

	it.each(CLEAN_TEXTS)('does not flag %s', (text) => {
		expect(containsUrl(text)).toBe(false);
	});

	it('treats null and undefined as no URL', () => {
		expect(containsUrl(null)).toBe(false);
		expect(containsUrl(undefined)).toBe(false);
	});
});

describe('containsContact (G3)', () => {
	it.each([
		'โทร 02-123-4567 ไลน์ @scam',
		'ติดต่อ 081-234-5678',
		'ติดต่อ 0812345678',
		'ติดต่อ 02 123 4567',
		'ติดต่อ \u{FF10}\u{FF18}\u{FF11}-\u{FF12}\u{FF13}\u{FF14}-\u{FF15}\u{FF16}\u{FF17}\u{FF18}',
		'โทร. 081\u{200B}234\u{200B}5678',
		'โทร +66 81 234 5678',
		'โทร +66812345678',
		'call +1 (202) 555-0143',
		'call +44 20 7946 0958',
		'โทรศัพท์: 1669',
		'สายด่วน 1300',
		'tel: 1234 5678',
		'แอดไลน์ @scam',
		'ไลน์ scam123',
		'ไลน์ไอดี scam123',
		'LINE: scam123',
		'LINE ID scam_123',
		'line id: @scam',
		'เขียนถึง press@agency.example.net',
		'ส่งอีเมลมาที่ help@example.co.th'
	])('flags %s', (text) => {
		expect(containsContact(text)).toBe(true);
	});

	it.each(CLEAN_TEXTS)('does not flag %s', (text) => {
		expect(containsContact(text)).toBe(false);
	});

	it('treats null and undefined as no contact', () => {
		expect(containsContact(null)).toBe(false);
		expect(containsContact(undefined)).toBe(false);
	});

	it('checks long text in bounded time (no ReDoS)', () => {
		const inputs = [
			'ก'.repeat(20_000),
			'0'.repeat(20_000),
			'+1 '.repeat(7_000),
			'a.'.repeat(10_000),
			'line '.repeat(4_000),
			'@a'.repeat(10_000),
			'เว็บ'.repeat(5_000) + '.'
		];
		for (const input of inputs) {
			const started = performance.now();
			containsUrl(input);
			containsContact(input);
			expect(performance.now() - started).toBeLessThan(200);
		}
	});
});

describe('normalizeGeneratedText', () => {
	it('removes format characters and folds fullwidth forms (NFKC)', () => {
		expect(normalizeGeneratedText('a\u{200B}b\u{200D}c\u{202E}d\u{2066}e\u{FEFF}f\u{00AD}g')).toBe(
			'abcdefg'
		);
		expect(normalizeGeneratedText('\u{FF45}\u{FF56}\u{FF49}\u{FF4C}\u{FF0E}com')).toBe('evil.com');
	});

	it('keeps Thai SARA AM as one character (NFKC alone would split it)', () => {
		const water = 'น้ำ';
		expect(water.normalize('NFKC')).not.toBe(water);
		expect(normalizeGeneratedText(water)).toBe(water);
		expect(normalizeGeneratedText('ทำงานในน้ำ')).toBe('ทำงานในน้ำ');
	});
});

describe('isThaiText', () => {
	it('needs non-blank text with Thai script', () => {
		expect(isThaiText('ข่าว')).toBe(true);
		expect(isThaiText('NATO ประชุม')).toBe(true);
		expect(isThaiText('English only')).toBe(false);
		expect(isThaiText('   ')).toBe(false);
		expect(isThaiText(null)).toBe(false);
	});
});
