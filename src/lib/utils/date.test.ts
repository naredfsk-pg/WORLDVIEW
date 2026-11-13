import { describe, expect, it } from 'vitest';
import { formatThaiDateTime, nowUtcIso, toBriefDate } from './date';

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
