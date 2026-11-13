import { describe, expect, it } from 'vitest';
import { parseFeedTimestamp } from './timestamps';

const now = new Date('2026-11-13T00:00:00.000Z');

describe('parseFeedTimestamp', () => {
	it.each([
		['RFC 822 GMT', 'Thu, 12 Nov 2026 16:59:59 GMT', '2026-11-12T16:59:59.000Z'],
		['RFC 822 numeric offset', 'Fri, 13 Nov 2026 00:00:00 +0700', '2026-11-12T17:00:00.000Z'],
		['RFC 822 without weekday', '12 Nov 2026 10:00:00 -0500', '2026-11-12T15:00:00.000Z'],
		['RFC 822 named US zone', 'Thu, 12 Nov 2026 10:00:00 EST', '2026-11-12T15:00:00.000Z'],
		['ISO with Z', '2026-11-12T17:00:00Z', '2026-11-12T17:00:00.000Z'],
		['ISO with offset and millis', '2026-11-13T00:30:00.250+07:00', '2026-11-12T17:30:00.250Z']
	])('parses %s', (_name, input, expected) => {
		expect(parseFeedTimestamp(input, now)).toBe(expected);
	});

	it.each([
		['missing', null],
		['empty', ''],
		['zone-less ISO (would be host-local time)', '2026-11-12T19:00:00'],
		['zone-less RFC 822', 'Thu, 12 Nov 2026 19:00:00'],
		['date only', '2026-11-12'],
		['garbage', 'yesterday'],
		['impossible date', '2026-13-45T00:00:00Z'],
		['more than 1 h in the future', '2026-11-13T01:00:01Z']
	])('returns null for %s', (_name, input) => {
		expect(parseFeedTimestamp(input, now)).toBeNull();
	});

	it('accepts up to 1 h of future clock skew', () => {
		expect(parseFeedTimestamp('2026-11-13T01:00:00Z', now)).toBe('2026-11-13T01:00:00.000Z');
	});
});
