/**
 * PRD §11 #5 (timezones), edge cases on top of date.test.ts: a feed timestamp goes through
 * `parseFeedTimestamp` then `toBriefDate`, so the brief date a reader sees depends on both. These
 * cases chain the two, with every zone format a feed can send, around Bangkok midnight and at
 * month, year and leap-day boundaries. Brief windows are checked at the same boundaries.
 */
import { describe, expect, it } from 'vitest';
import { briefWindow } from '#lib/server/jobs/briefs.js';
import { addDays, bangkokDayRangeUtc, hourSlot, parseFeedTimestamp, toBriefDate } from './date';

const NOW = new Date('2030-01-01T00:00:00.000Z');

describe('feed timestamp → Bangkok brief date', () => {
	it.each([
		// RFC 822 with a numeric offset, GMT and a US zone name
		['Thu, 12 Nov 2026 23:59:59 +0700', '2026-11-12'],
		['Fri, 13 Nov 2026 00:00:00 +0700', '2026-11-13'],
		['Thu, 12 Nov 2026 16:59:59 GMT', '2026-11-12'],
		['Thu, 12 Nov 2026 17:00:00 GMT', '2026-11-13'],
		['Thu, 12 Nov 2026 11:59:59 EST', '2026-11-12'],
		['Thu, 12 Nov 2026 12:00:00 EST', '2026-11-13'],
		// ISO 8601 with Z, a negative offset and an offset without a colon
		['2026-11-12T16:59:59.999Z', '2026-11-12'],
		['2026-11-12T12:00:00-05:00', '2026-11-13'],
		['2026-11-13T00:00:00+0700', '2026-11-13'],
		// month, year and leap-day boundaries
		['2026-11-30T17:00:00Z', '2026-12-01'],
		['Thu, 31 Dec 2026 16:59:59 GMT', '2026-12-31'],
		['Thu, 31 Dec 2026 17:00:00 GMT', '2027-01-01'],
		['2028-02-28T17:00:00Z', '2028-02-29'],
		['2028-02-29T17:00:00Z', '2028-03-01']
	])('%s is on %s', (raw, expected) => {
		const utc = parseFeedTimestamp(raw, NOW);
		expect(utc).not.toBeNull();
		expect(toBriefDate(utc!)).toBe(expected);
	});

	it.each([
		'Thu, 12 Nov 2026 23:59:59', // no zone: a guess would use the host clock
		'2026-11-12T23:59:59', // no zone
		'2026-11-12', // date only
		'Thu, 29 Feb 2027 10:00:00 GMT', // 2027 is not a leap year
		'2026-11-12T24:00:00Z' // hour 24
	])('%s has no brief date (null, never a guess)', (raw) => {
		expect(parseFeedTimestamp(raw, NOW)).toBeNull();
	});
});

describe('brief windows at month and year boundaries (ICT, [start, end))', () => {
	it('morning of 1 Jan starts at 07:00 ICT on 31 Dec of the previous year', () => {
		expect(briefWindow('2027-01-01', 'morning')).toMatchObject({
			start_utc: '2026-12-31T00:00:00.000Z',
			end_utc: '2027-01-01T00:00:00.000Z'
		});
	});

	it('evening of 1 Mar in a leap year starts on 29 Feb', () => {
		expect(briefWindow('2028-03-01', 'evening')).toMatchObject({
			start_utc: '2028-02-29T12:00:00.000Z',
			end_utc: '2028-03-01T12:00:00.000Z'
		});
	});

	it('the daily snapshot of 31 Dec ends where 1 Jan begins, with no gap or overlap', () => {
		const lastDay = briefWindow('2026-12-31', 'daily_snapshot');
		const firstDay = bangkokDayRangeUtc(addDays('2026-12-31', 1));
		expect(firstDay.start_utc).toBe(lastDay.end_utc);
		expect(toBriefDate(lastDay.start_utc)).toBe('2026-12-31');
		expect(toBriefDate(firstDay.start_utc)).toBe('2027-01-01');
	});

	it('an article at the exact window end belongs to the next window only', () => {
		const morning = briefWindow('2026-11-13', 'morning');
		const nextMorning = briefWindow('2026-11-14', 'morning');
		const atEdge = parseFeedTimestamp('Fri, 13 Nov 2026 07:00:00 +0700', NOW)!;
		expect(atEdge >= morning.start_utc && atEdge < morning.end_utc).toBe(false);
		expect(atEdge >= nextMorning.start_utc && atEdge < nextMorning.end_utc).toBe(true);
	});
});

describe('hourly job slots follow the Bangkok clock', () => {
	it('16:59 and 17:00 UTC are different Bangkok days', () => {
		const before = hourSlot(new Date('2026-12-31T16:59:59.999Z'));
		const after = hourSlot(new Date('2026-12-31T17:00:00.000Z'));
		expect(before.startsWith('2026-12-31')).toBe(true);
		expect(after.startsWith('2027-01-01')).toBe(true);
	});
});
