/**
 * Idempotency keys and `scheduled_for` per job (ARCHITECTURE §8). All Bangkok wall-clock math
 * goes through `#lib/utils/date` (Intl with an explicit zone; never the host timezone).
 *
 * | Job                           | Key                       | scheduled_for              |
 * |-------------------------------|---------------------------|----------------------------|
 * | ingest, digest, reevaluate_pending | `{type}:{hourSlot(now)}` | start of that Bangkok hour |
 * | brief_morning / brief_evening | `{type}:{date}`           | date 07:00 / 19:00 ICT     |
 * | archive_snapshot              | `archive_snapshot:{date}` | date + 1, 01:00 ICT        |
 */
import type { BriefDate } from '#lib/types/domain.js';
import { addDays, bangkokDateTimeToUtc, hourSlot } from '#lib/utils/date.js';

export interface JobSlot {
	idempotency_key: string;
	scheduled_for: string;
}

/**
 * `variant` namespaces a non-production run (`ingest:fixtures:{hour}`), so a fixture run can
 * never consume the real `ingest:{hour}` slot.
 */
export function hourlyJobSlot(
	jobType: 'ingest' | 'digest' | 'reevaluate_pending',
	now: Date,
	variant: 'fixtures' | null = null
): JobSlot {
	const slot = hourSlot(now);
	return {
		idempotency_key: variant ? `${jobType}:${variant}:${slot}` : `${jobType}:${slot}`,
		scheduled_for: bangkokDateTimeToUtc(slot.slice(0, 10), `${slot.slice(11)}:00`)
	};
}

export function briefJobSlot(jobType: 'brief_morning' | 'brief_evening', date: BriefDate): JobSlot {
	const publishTime = jobType === 'brief_morning' ? '07:00' : '19:00';
	return {
		idempotency_key: `${jobType}:${date}`,
		scheduled_for: bangkokDateTimeToUtc(date, publishTime)
	};
}

/** The snapshot of `date` is scheduled for 01:00 ICT on the next Bangkok day. */
export function archiveJobSlot(date: BriefDate): JobSlot {
	return {
		idempotency_key: `archive_snapshot:${date}`,
		scheduled_for: bangkokDateTimeToUtc(addDays(date, 1), '01:00')
	};
}
