import { describe, expect, it } from 'vitest';
import { containsUrl, isThaiText } from './text';

describe('containsUrl (G3)', () => {
	it.each([
		'อ่านต่อที่ https://news.example.org/a/1',
		'ดู http://x.example',
		'ข้อมูลจาก www.example.com',
		'ดูที่ evil-news.example.com/x',
		'ติดต่อ example.com',
		'แหล่งข่าว NEWS.EXAMPLE.ORG',
		'อีเมล press@agency.example.net',
		'ลิงก์ซ่อนex.co.th/path?q=1'
	])('flags %s', (text) => {
		expect(containsUrl(text)).toBe(true);
	});

	it.each([
		'สหรัฐฯ (U.S.) ขึ้นดอกเบี้ย 2.5%',
		'เศรษฐกิจโต 3.14 เปอร์เซ็นต์ในไตรมาส 2',
		'ราคาเพิ่มขึ้น เช่น e.g. ค่าขนส่ง',
		'ซอฟต์แวร์รุ่น 1.2.3 ถูกปล่อยแล้ว',
		'เวลา 10.30 น. ตามเวลาไทย',
		'ธนาคาร J.P. Morgan ระบุว่า',
		'ข่าวภาษาไทยล้วนไม่มีลิงก์ใดๆ',
		''
	])('does not flag %s', (text) => {
		expect(containsUrl(text)).toBe(false);
	});

	it('treats null and undefined as no URL', () => {
		expect(containsUrl(null)).toBe(false);
		expect(containsUrl(undefined)).toBe(false);
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
