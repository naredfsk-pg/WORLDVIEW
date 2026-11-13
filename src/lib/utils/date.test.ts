import { describe, expect, it } from 'vitest';
import {
	addDays,
	bangkokDateTimeToUtc,
	bangkokDayRangeUtc,
	formatThaiDate,
	formatThaiDateTime,
	formatThaiTime,
	hourSlot,
	isBriefDate,
	isYearMonth,
	monthOf,
	nowUtcIso,
	todayBriefDate,
	toBriefDate
} from './date';

describe('toBriefDate (Asia/Bangkok, UTC+7)', () => {
	it.each([
		['2026-11-12T16:59:59Z', '2026-11-12'],
		['2026-11-12T16:59:59.999Z', '2026-11-12'],
		['2026-11-12T17:00:00Z', '2026-11-13'],
		['2026-11-12T00:00:00Z', '2026-11-12'],
		['2026-12-31T17:00:00Z', '2027-01-01'],
		['2028-02-28T17:00:00Z', '2028-02-29'],
		['2026-11-13T00:30:00+07:00', '2026-11-13']
	])('%s -> %s', (utcIso, expected) => {
		expect(toBriefDate(utcIso)).toBe(expected);
	});

	it('accepts another IANA timezone', () => {
		expect(toBriefDate('2026-11-12T17:00:00Z', 'UTC')).toBe('2026-11-12');
	});

	it.each(['2026-11-12T17:00:00', '2026-11-12', 'not a date', ''])(
		'rejects %j (no explicit offset or invalid)',
		(input) => {
			expect(() => toBriefDate(input)).toThrow(RangeError);
		}
	);
});

describe('nowUtcIso', () => {
	it('returns a UTC ISO string', () => {
		const value = nowUtcIso();
		expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(Math.abs(Date.parse(value) - Date.now())).toBeLessThan(5000);
	});
});

describe('formatThaiDateTime', () => {
	it('formats in Thai with the Gregorian year in Bangkok time', () => {
		const text = formatThaiDateTime('2026-11-12T17:00:00Z');
		expect(text).toContain('13 พฤศจิกายน 2026');
		expect(text).not.toContain('2569');
		expect(text).not.toContain('ค.ศ.');
		expect(text).toContain('00:00');
	});

	it('stays on the previous Thai day one second before midnight', () => {
		const text = formatThaiDateTime('2026-11-12T16:59:59Z');
		expect(text).toContain('12 พฤศจิกายน 2026');
		expect(text).toContain('23:59');
	});
});

describe('todayBriefDate', () => {
	it('switches at Bangkok midnight, not UTC midnight', () => {
		expect(todayBriefDate(new Date('2026-11-12T16:59:59.999Z'))).toBe('2026-11-12');
		expect(todayBriefDate(new Date('2026-11-12T17:00:00.000Z'))).toBe('2026-11-13');
	});
});

describe('isBriefDate / isYearMonth / monthOf', () => {
	it.each(['2026-11-13', '2028-02-29', '1970-01-01'])('accepts %s', (value) => {
		expect(isBriefDate(value)).toBe(true);
	});

	it.each(['2026-02-30', '2026-13-01', '2026-1-01', '1969-12-31', '0099-01-01', '', null])(
		'rejects %j',
		(value) => {
			expect(isBriefDate(value)).toBe(false);
		}
	);

	it('validates months from 1970 on', () => {
		expect(isYearMonth('2026-11')).toBe(true);
		expect(isYearMonth('2026-00')).toBe(false);
		expect(isYearMonth('2026-13')).toBe(false);
		expect(isYearMonth('1969-12')).toBe(false);
		expect(monthOf('2026-11-13')).toBe('2026-11');
	});
});

describe('addDays', () => {
	it.each([
		['2026-11-13', -1, '2026-11-12'],
		['2026-12-31', 1, '2027-01-01'],
		['2028-03-01', -1, '2028-02-29'],
		['2026-11-13', 0, '2026-11-13']
	])('%s %+d -> %s', (date, days, expected) => {
		expect(addDays(date, days)).toBe(expected);
	});

	it('rejects a non-date', () => {
		expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
	});
});

describe('bangkokDateTimeToUtc / bangkokDayRangeUtc', () => {
	it('converts Bangkok wall-clock time to UTC', () => {
		expect(bangkokDateTimeToUtc('2026-11-13', '07:00')).toBe('2026-11-13T00:00:00.000Z');
		expect(bangkokDateTimeToUtc('2026-11-13', '00:00')).toBe('2026-11-12T17:00:00.000Z');
		expect(bangkokDateTimeToUtc('2027-01-01', '01:00')).toBe('2026-12-31T18:00:00.000Z');
	});

	it.each(['7:00', '24:00', '07:60', ''])('rejects time %j', (hhmm) => {
		expect(() => bangkokDateTimeToUtc('2026-11-13', hhmm)).toThrow(RangeError);
	});

	it('gives the Bangkok day as [start, end)', () => {
		expect(bangkokDayRangeUtc('2026-11-13')).toEqual({
			start_utc: '2026-11-12T17:00:00.000Z',
			end_utc: '2026-11-13T17:00:00.000Z'
		});
	});
});

describe('hourSlot', () => {
	it('uses the Bangkok hour', () => {
		expect(hourSlot(new Date('2026-11-12T23:30:00.000Z'))).toBe('2026-11-13T06');
	});
});

describe('formatThaiDate / formatThaiTime', () => {
	it('reads a BriefDate as Bangkok noon, so it never shifts', () => {
		expect(formatThaiDate('2026-11-13')).toBe('13 พ.ย. 2026');
		expect(formatThaiDate('2026-11-13', 'long')).toBe('13 พฤศจิกายน 2026');
	});

	it('formats instants in Bangkok time', () => {
		expect(formatThaiDate('2026-11-12T17:00:00.000Z')).toBe('13 พ.ย. 2026');
		expect(formatThaiTime('2026-11-13T00:05:00.000Z')).toBe('07:05 น.');
	});
});
