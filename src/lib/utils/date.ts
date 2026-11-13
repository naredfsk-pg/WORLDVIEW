/**
 * Time model (ARCHITECTURE §7): timestamps are stored as UTC ISO strings and converted to
 * Asia/Bangkok only for display, job keys and archive grouping (`brief_date`). Pure and
 * isomorphic: every conversion goes through `Intl` with an explicit time zone, never the host's.
 */
import type { BriefDate, IsoUtc, YearMonth } from '../types/domain';

export const DEFAULT_TIMEZONE = 'Asia/Bangkok';

// Require an explicit offset: `new Date('2026-11-12T16:59:59')` would silently use host-local time.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const BRIEF_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const HOUR_MINUTE_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** `Date.UTC` maps years 0–99 to 1900+, and nothing in WORLDVIEW predates the Unix epoch. */
const MIN_YEAR = 1970;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Current instant as a UTC ISO string, e.g. `2026-11-13T02:50:00.000Z`. */
export function nowUtcIso(): IsoUtc {
	return new Date().toISOString();
}

/** Calendar date (`YYYY-MM-DD`) of an instant in the given timezone (Asia/Bangkok by default). */
export function toBriefDate(utcIso: IsoUtc, timeZone: string = DEFAULT_TIMEZONE): BriefDate {
	const parts = zonedParts(parseUtcIso(utcIso), timeZone);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Today's Bangkok calendar date. */
export function todayBriefDate(now: Date = new Date()): BriefDate {
	const parts = zonedParts(now, DEFAULT_TIMEZONE);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

/** `YYYY-MM-DD` that is also a real calendar day, from 1970 on. */
export function isBriefDate(value: string | null | undefined): value is BriefDate {
	const match = BRIEF_DATE_PATTERN.exec(value ?? '');
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (year < MIN_YEAR) return false;
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

/** `YYYY-MM` with a real month, from 1970 on. */
export function isYearMonth(value: string | null | undefined): value is YearMonth {
	const match = YEAR_MONTH_PATTERN.exec(value ?? '');
	return (
		match !== null &&
		Number(match[1]) >= MIN_YEAR &&
		Number(match[2]) >= 1 &&
		Number(match[2]) <= 12
	);
}

export function monthOf(date: BriefDate): YearMonth {
	return date.slice(0, 7);
}

/** Calendar arithmetic on a `BriefDate` (no time zone involved: a date is not an instant). */
export function addDays(date: BriefDate, days: number): BriefDate {
	const [year, month, day] = parseBriefDate(date);
	return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Bangkok wall-clock time on `date` as a UTC instant:
 * `bangkokDateTimeToUtc('2026-11-13', '07:00')` → `'2026-11-13T00:00:00.000Z'`.
 */
export function bangkokDateTimeToUtc(date: BriefDate, hhmm: string): IsoUtc {
	const [year, month, day] = parseBriefDate(date);
	const time = HOUR_MINUTE_PATTERN.exec(hhmm);
	if (!time) throw new RangeError(`Expected HH:MM, got "${hhmm}"`);
	const wallAsUtcMs = Date.UTC(year, month - 1, day, Number(time[1]), Number(time[2]));
	// The zone offset comes from Intl instead of a hard-coded +07:00 (ICT has no DST).
	return new Date(wallAsUtcMs - zoneOffsetMs(new Date(wallAsUtcMs))).toISOString();
}

/** The Bangkok calendar day as a UTC range, `[start, end)`. */
export function bangkokDayRangeUtc(date: BriefDate): { start_utc: IsoUtc; end_utc: IsoUtc } {
	return {
		start_utc: bangkokDateTimeToUtc(date, '00:00'),
		end_utc: bangkokDateTimeToUtc(addDays(date, 1), '00:00')
	};
}

/** Bangkok wall-clock hour of an instant, `YYYY-MM-DDTHH`, e.g. `2026-11-13T06` (job keys). */
export function hourSlot(instant: Date): string {
	const parts = zonedParts(instant, DEFAULT_TIMEZONE);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
}

/** "13 พ.ย. 2026" (short) or "13 พฤศจิกายน 2026" (long). A BriefDate is read as Bangkok noon. */
export function formatThaiDate(
	value: IsoUtc | BriefDate,
	style: 'short' | 'long' = 'short'
): string {
	return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
		timeZone: DEFAULT_TIMEZONE,
		day: 'numeric',
		month: style,
		year: 'numeric'
	}).format(toDisplayInstant(value));
}

/** "07:05 น." in Bangkok time. */
export function formatThaiTime(value: IsoUtc): string {
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: DEFAULT_TIMEZONE,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(toDisplayInstant(value));
	return `${time} น.`;
}

/**
 * Thai display string with the Gregorian year (ARCHITECTURE §7, §18 #11), 24-hour clock,
 * e.g. `13 พฤศจิกายน 2026 เวลา 00:00`.
 */
export function formatThaiDateTime(utcIso: IsoUtc, timeZone: string = DEFAULT_TIMEZONE): string {
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

// ---------------------------------------------------------------------------
// Feed timestamps (ARCHITECTURE §7, §9)
// ---------------------------------------------------------------------------

/** Feed clocks drift; anything further in the future than this is treated as bogus. */
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000;

/** ISO 8601 with a mandatory `Z` or `±HH:MM` offset. */
const FEED_ISO_WITH_ZONE =
	/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** RFC 822 / 2822 with a 4-digit year and a mandatory zone (numeric or a common name). */
const FEED_RFC_822_WITH_ZONE =
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
export function parseFeedTimestamp(raw: string | null | undefined, now: Date): IsoUtc | null {
	if (!raw) return null;
	const value = raw.trim();
	if (value.length > 64) return null;
	const fields = (FEED_ISO_WITH_ZONE.exec(value) ?? FEED_RFC_822_WITH_ZONE.exec(value))?.groups;
	if (!fields || !isRealDateTime(fields)) return null;

	const ms = Date.parse(value);
	if (Number.isNaN(ms)) return null;
	if (ms > now.getTime() + MAX_FUTURE_SKEW_MS) return null;
	return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function parseUtcIso(utcIso: string): Date {
	const date = new Date(utcIso);
	if (!ISO_WITH_OFFSET.test(utcIso) || Number.isNaN(date.getTime())) {
		throw new RangeError(`Expected an ISO 8601 timestamp with Z or an offset, got "${utcIso}"`);
	}
	return date;
}

function parseBriefDate(date: BriefDate): [number, number, number] {
	if (!isBriefDate(date)) throw new RangeError(`Expected a YYYY-MM-DD date, got "${date}"`);
	return date.split('-').map(Number) as [number, number, number];
}

/** A BriefDate is shown as Bangkok noon so it never shifts by a day; anything else is an instant. */
function toDisplayInstant(value: IsoUtc | BriefDate): Date {
	return new Date(BRIEF_DATE_PATTERN.test(value) ? `${value}T12:00:00+07:00` : value);
}

/** Bangkok wall clock minus UTC at `instant`, in ms (+7 h for ICT). */
function zoneOffsetMs(instant: Date): number {
	const parts = zonedParts(instant, DEFAULT_TIMEZONE);
	const wallAsUtcMs = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	return wallAsUtcMs - Math.floor(instant.getTime() / 1000) * 1000;
}

function zonedParts(
	instant: Date,
	timeZone: string
): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
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
