/**
 * Idempotency keys for the hourly jobs (ARCHITECTURE §8): `{type}:{hourSlot(now)}` with
 * `scheduled_for` = the start of that Asia/Bangkok hour, as UTC. Uses `Intl` (no host timezone).
 * Brief/archive keys (`{type}:{date}`) belong to Wave 2.
 */
import { DEFAULT_TIMEZONE } from '#lib/utils/date.js';

/** Bangkok wall-clock hour of an instant, `YYYY-MM-DDTHH`, e.g. `2026-11-13T06`. */
export function hourSlot(instant: Date): string {
	const { year, month, day, hour } = bangkokParts(instant);
	return `${year}-${month}-${day}T${hour}`;
}

/**
 * `variant` namespaces a non-production run (`ingest:fixtures:{hour}`), so a fixture run can
 * never consume the real `ingest:{hour}` slot.
 */
export function hourlyJobSlot(
	jobType: 'ingest' | 'digest',
	now: Date,
	variant: 'fixtures' | null = null
): { idempotency_key: string; scheduled_for: string } {
	const parts = bangkokParts(now);
	// Wall-clock time read as if it were UTC, minus the real instant = the zone offset.
	const wallAsUtcMs = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	const offsetMs = wallAsUtcMs - Math.floor(now.getTime() / 1000) * 1000;
	const hourStartWallMs = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour)
	);
	return {
		idempotency_key: variant
			? `${jobType}:${variant}:${hourSlot(now)}`
			: `${jobType}:${hourSlot(now)}`,
		scheduled_for: new Date(hourStartWallMs - offsetMs).toISOString()
	};
}

function bangkokParts(
	instant: Date
): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: DEFAULT_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((entry) => entry.type === type)?.value ?? '00';
	return {
		year: part('year'),
		month: part('month'),
		day: part('day'),
		hour: part('hour'),
		minute: part('minute'),
		second: part('second')
	};
}
