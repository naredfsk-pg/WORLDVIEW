/**
 * `parseFeedTimestamp` (ARCHITECTURE §7). The contract places it in `utils/date.ts`; it lives here
 * until that lane adds it. Pure: `now` is injected.
 */

/** Feed clocks drift; anything further in the future than this is treated as bogus. */
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000;

/** ISO 8601 with a mandatory `Z` or `±HH:MM` offset. */
const ISO_WITH_ZONE =
	/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** RFC 822 / 2822 with a 4-digit year and a mandatory zone (numeric or a common name). */
const RFC_822_WITH_ZONE =
	/^(?:[A-Za-z]{3},\s*)?(?<day>\d{1,2})\s+(?<monthName>[A-Za-z]{3})\s+(?<year>\d{4})\s+(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?\s+(?:[+-]\d{4}|GMT|UTC?|Z|[ECMP][SD]T)$/i;

const MONTH_NAMES = [
	'jan',
	'feb',
	'mar',
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec'
];

/**
 * UTC ISO string for an RFC 822 or ISO 8601 feed timestamp. Returns null when the input is
 * missing, unparseable, not a real calendar date/time (JS would roll "31 Feb" over to 3 Mar),
 * has no zone (a guess would use host-local time), or is more than 1 h after `now`. Never guesses.
 */
export function parseFeedTimestamp(raw: string | null | undefined, now: Date): string | null {
	if (!raw) return null;
	const value = raw.trim();
	if (value.length > 64) return null;
	const fields = (ISO_WITH_ZONE.exec(value) ?? RFC_822_WITH_ZONE.exec(value))?.groups;
	if (!fields || !isRealDateTime(fields)) return null;

	const ms = Date.parse(value);
	if (Number.isNaN(ms)) return null;
	if (ms > now.getTime() + MAX_FUTURE_SKEW_MS) return null;
	return new Date(ms).toISOString();
}

function isRealDateTime(fields: Record<string, string | undefined>): boolean {
	const year = Number(fields['year']);
	const monthIndex = fields['monthName']
		? MONTH_NAMES.indexOf(fields['monthName'].toLowerCase())
		: Number(fields['month']) - 1;
	const day = Number(fields['day']);
	if (monthIndex < 0 || monthIndex > 11) return false;

	const calendarDay = new Date(Date.UTC(year, monthIndex, day));
	const isRealDay = calendarDay.getUTCMonth() === monthIndex && calendarDay.getUTCDate() === day;
	const isRealTime =
		Number(fields['hour']) <= 23 &&
		Number(fields['minute']) <= 59 &&
		Number(fields['second'] ?? 0) <= 59;
	return isRealDay && isRealTime;
}
