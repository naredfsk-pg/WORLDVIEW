import { describe, expect, it } from 'vitest';
import {
	addMonths,
	categoryLabel,
	formatEyebrowDate,
	formatThaiDate,
	formatThaiDateTimeShort,
	formatThaiMonth,
	formatThaiTime,
	isBriefDate,
	isHttpUrl,
	isYearMonth,
	monthGrid,
	parseCategory,
	parseEdition,
	parsePageNumber,
	regionsLabel,
	RELATION_LABEL_TH
} from './format';

describe('date helpers (Asia/Bangkok, Gregorian year)', () => {
	it('formats brief dates without shifting the day', () => {
		expect(formatThaiDate('2026-11-13')).toBe('13 พ.ย. 2026');
		expect(formatThaiDate('2026-11-13', 'long')).toBe('13 พฤศจิกายน 2026');
		expect(formatThaiDate('2026-01-01', 'long')).toBe('1 มกราคม 2026');
	});

	it('converts UTC instants to Bangkok time', () => {
		expect(formatThaiTime('2026-11-13T00:05:00.000Z')).toBe('07:05 น.');
		// 17:00Z is already the next day in Bangkok.
		expect(formatThaiDate('2026-11-12T17:00:00.000Z')).toBe('13 พ.ย. 2026');
		expect(formatThaiDateTimeShort('2026-11-12T16:59:00.000Z')).toBe('12 พ.ย. 2026 · 23:59 น.');
	});

	it('formats months and the English eyebrow', () => {
		expect(formatThaiMonth('2026-11')).toBe('พฤศจิกายน 2026');
		expect(formatEyebrowDate('2026-11-13')).toBe('FRIDAY · 13 NOVEMBER 2026');
	});

	it('validates real calendar dates and months', () => {
		expect(isBriefDate('2026-11-13')).toBe(true);
		expect(isBriefDate('2026-02-30')).toBe(false);
		expect(isBriefDate('2026-11-1')).toBe(false);
		expect(isBriefDate('../etc')).toBe(false);
		expect(isBriefDate(null)).toBe(false);
		expect(isYearMonth('2026-11')).toBe(true);
		expect(isYearMonth('2026-13')).toBe(false);
	});

	it('rejects years before 1970 (Date.UTC maps 0–99 to 1900+)', () => {
		expect(isBriefDate('0050-01-01')).toBe(false);
		expect(isBriefDate('1969-12-31')).toBe(false);
		expect(isBriefDate('1970-01-01')).toBe(true);
		expect(isYearMonth('0050-01')).toBe(false);
		expect(isYearMonth('1970-01')).toBe(true);
	});

	it('moves across year boundaries', () => {
		expect(addMonths('2026-12', 1)).toBe('2027-01');
		expect(addMonths('2026-01', -1)).toBe('2025-12');
	});

	it('builds a Sunday-first month grid', () => {
		const weeks = monthGrid('2026-11');
		// 1 Nov 2026 is a Sunday; 30 days → 5 weeks.
		expect(weeks).toHaveLength(5);
		expect(weeks[0]?.[0]).toEqual({ date: '2026-11-01', day: 1 });
		expect(weeks.flat().filter((cell) => cell !== null)).toHaveLength(30);
		// 1 Oct 2026 is a Thursday → four leading blanks.
		expect(monthGrid('2026-10')[0]?.slice(0, 5)).toEqual([
			null,
			null,
			null,
			null,
			{ date: '2026-10-01', day: 1 }
		]);
	});
});

describe('URL param and link helpers', () => {
	it('clamps the page number to a safe integer in [1, max]', () => {
		expect(parsePageNumber(null, 50)).toBe(1);
		expect(parsePageNumber('3', 50)).toBe(3);
		expect(parsePageNumber('0', 50)).toBe(1);
		expect(parsePageNumber('-4', 50)).toBe(1);
		expect(parsePageNumber('2.5', 50)).toBe(1);
		expect(parsePageNumber('abc', 50)).toBe(1);
		expect(parsePageNumber('1000000000000000000', 50)).toBe(1);
		expect(parsePageNumber('9'.repeat(400), 50)).toBe(1);
		expect(parsePageNumber('51', 50)).toBe(50);
	});

	it('accepts only absolute http(s) URLs', () => {
		expect(isHttpUrl('https://example.com/a')).toBe(true);
		expect(isHttpUrl('HTTP://example.com')).toBe(true);
		expect(isHttpUrl('javascript:alert(1)')).toBe(false);
		expect(isHttpUrl(' javascript:alert(1)')).toBe(false);
		expect(isHttpUrl('JaVaScRiPt:alert(1)')).toBe(false);
		expect(isHttpUrl('data:text/html,x')).toBe(false);
		expect(isHttpUrl('//evil.example')).toBe(false);
		expect(isHttpUrl('/relative')).toBe(false);
		expect(isHttpUrl('')).toBe(false);
		expect(isHttpUrl(null)).toBe(false);
	});
});

describe('label helpers', () => {
	it('maps category slugs to Thai labels and parses URL values', () => {
		expect(categoryLabel('geopolitics')).toBe('ภูมิรัฐศาสตร์');
		expect(categoryLabel('society')).toBe('สังคม');
		expect(parseCategory('economy')).toBe('economy');
		expect(parseCategory('sports')).toBeNull();
		expect(parseCategory(null)).toBeNull();
	});

	it('joins regions and parses editions', () => {
		expect(regionsLabel(['americas', 'asia'])).toBe('อเมริกา · เอเชีย');
		expect(regionsLabel([])).toBe('');
		expect(parseEdition('evening')).toBe('evening');
		expect(parseEdition('noon')).toBeNull();
	});

	it('labels potential_impact as possible, not confirmed', () => {
		expect(RELATION_LABEL_TH.potential_impact).toBe('อาจเกี่ยวข้อง/เป็นไปได้');
	});
});
