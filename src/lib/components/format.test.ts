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
	isYearMonth,
	monthGrid,
	parseCategory,
	parseEdition,
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
