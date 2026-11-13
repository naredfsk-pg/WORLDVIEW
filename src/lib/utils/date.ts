/**
 * Time model (PRD §7): timestamps are stored as UTC ISO strings and converted to
 * Asia/Bangkok only for display and archive grouping (`brief_date`).
 */

export const DEFAULT_TIMEZONE = 'Asia/Bangkok';

// Require an explicit offset: `new Date('2026-11-12T16:59:59')` would silently use host-local time.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Current instant as a UTC ISO string, e.g. `2026-11-13T02:50:00.000Z`. */
export function nowUtcIso(): string {
	return new Date().toISOString();
}

/** Calendar date (`YYYY-MM-DD`) of an instant in the given timezone (Asia/Bangkok by default). */
export function toBriefDate(utcIso: string, timeZone: string = DEFAULT_TIMEZONE): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(parseUtcIso(utcIso));

	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
	return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Thai display string with the Gregorian year (ARCHITECTURE §7, §18 #11), 24-hour clock,
 * e.g. `13 พฤศจิกายน 2026 เวลา 00:00`.
 */
export function formatThaiDateTime(utcIso: string, timeZone: string = DEFAULT_TIMEZONE): string {
	// Explicit fields: `dateStyle: 'long'` would add the era marker "ค.ศ." in the Gregorian calendar.
	return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
		timeZone,
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(parseUtcIso(utcIso));
}

function parseUtcIso(utcIso: string): Date {
	const date = new Date(utcIso);
	if (!ISO_WITH_OFFSET.test(utcIso) || Number.isNaN(date.getTime())) {
		throw new RangeError(`Expected an ISO 8601 timestamp with Z or an offset, got "${utcIso}"`);
	}
	return date;
}
