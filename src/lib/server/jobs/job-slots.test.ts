import { describe, expect, it } from 'vitest';
import { hourSlot } from '#lib/utils/date.js';
import { archiveJobSlot, briefJobSlot, hourlyJobSlot } from './job-slots';

describe('hourSlot / hourlyJobSlot (Asia/Bangkok, ARCHITECTURE §8)', () => {
	it.each([
		['06:00 ICT ingest', '2026-11-12T23:00:05.000Z', '2026-11-13T06', '2026-11-12T23:00:00.000Z'],
		[
			'last second before Bangkok midnight',
			'2026-11-12T16:59:59.999Z',
			'2026-11-12T23',
			'2026-11-12T16:00:00.000Z'
		],
		['Bangkok midnight', '2026-11-12T17:00:00.000Z', '2026-11-13T00', '2026-11-12T17:00:00.000Z'],
		['23:00 ICT ingest', '2026-11-13T16:00:00.000Z', '2026-11-13T23', '2026-11-13T16:00:00.000Z'],
		['year boundary', '2026-12-31T17:30:00.000Z', '2027-01-01T00', '2026-12-31T17:00:00.000Z']
	])('%s', (_name, instant, slot, scheduledFor) => {
		const now = new Date(instant);
		expect(hourSlot(now)).toBe(slot);
		expect(hourlyJobSlot('ingest', now)).toEqual({
			idempotency_key: `ingest:${slot}`,
			scheduled_for: scheduledFor
		});
	});

	it('gives the same key for any instant within the hour', () => {
		const first = hourlyJobSlot('digest', new Date('2026-11-12T23:00:00.000Z'));
		const last = hourlyJobSlot('digest', new Date('2026-11-12T23:59:59.999Z'));
		expect(last).toEqual(first);
		expect(first.idempotency_key).toBe('digest:2026-11-13T06');
	});

	it('namespaces a fixtures run so it never takes the real slot', () => {
		const now = new Date('2026-11-12T23:00:00.000Z');
		expect(hourlyJobSlot('ingest', now, 'fixtures')).toEqual({
			idempotency_key: 'ingest:fixtures:2026-11-13T06',
			scheduled_for: hourlyJobSlot('ingest', now).scheduled_for
		});
	});

	it('keys brief and archive jobs by Bangkok date', () => {
		expect(briefJobSlot('brief_morning', '2026-11-13')).toEqual({
			idempotency_key: 'brief_morning:2026-11-13',
			scheduled_for: '2026-11-13T00:00:00.000Z'
		});
		expect(briefJobSlot('brief_evening', '2026-11-13')).toEqual({
			idempotency_key: 'brief_evening:2026-11-13',
			scheduled_for: '2026-11-13T12:00:00.000Z'
		});
		expect(archiveJobSlot('2026-12-31')).toEqual({
			idempotency_key: 'archive_snapshot:2026-12-31',
			scheduled_for: '2026-12-31T18:00:00.000Z'
		});
	});
});
