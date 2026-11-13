/**
 * Pure display helpers for the UI: Thai labels, Bangkok-time formatting, URL-param parsing and the
 * archive month grid. Gregorian year with Thai month names (ARCHITECTURE §7, §18 #11).
 *
 * CONTRACT-GAP: ARCHITECTURE §7 lists `isBriefDate`, `isYearMonth`, `monthOf`, `formatThaiDate` and
 * `formatThaiTime` for `#lib/utils/date.ts` (backend #1). They are not there yet and `utils/` is
 * outside the frontend's scope, so the UI keeps its own copies here. Swap to the utils versions
 * once they land.
 */
import {
	BRIEF_EDITIONS,
	CATEGORY_LABEL_TH,
	CATEGORY_SLUGS,
	REGION_LABEL_TH,
	type BriefDate,
	type BriefEdition,
	type CategorySlug,
	type IsoUtc,
	type RegionSlug,
	type RelationType,
	type YearMonth
} from '../types/domain';

const TIME_ZONE = 'Asia/Bangkok';
const BRIEF_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export const TIMEZONE_LABEL = 'เวลาไทย (GMT+7)';
export const UNKNOWN_OCCURRED_AT = 'ไม่ทราบเวลาเกิดเหตุ';
export const UNKNOWN_PUBLISHED_AT = 'ไม่ระบุเวลาเผยแพร่';
export const DEMO_LABEL = 'ข้อมูลตัวอย่าง ไม่ใช่ข่าวจริง';
export const SINGLE_SOURCE_LABEL = 'แหล่งข่าวเดียว';

export const EDITION_LABEL_TH: Record<BriefEdition, string> = {
	morning: 'รอบเช้า',
	evening: 'รอบเย็น',
	daily_snapshot: 'สรุปประจำวัน'
};

/** Read as "from <label> to". `potential_impact` is worded as possible, never confirmed. */
export const RELATION_LABEL_TH: Record<RelationType, string> = {
	same_topic: 'เรื่องเดียวกัน',
	follow_up: 'ความคืบหน้าต่อเนื่อง',
	response_to: 'เป็นการตอบสนองต่อ',
	background_of: 'เป็นบริบทของ',
	potential_impact: 'อาจเกี่ยวข้อง/เป็นไปได้'
};

export function categoryLabel(slug: CategorySlug): string {
	return CATEGORY_LABEL_TH[slug];
}

/** "อเมริกา · เอเชีย"; empty string for no regions. */
export function regionsLabel(regions: readonly RegionSlug[]): string {
	return regions.map((region) => REGION_LABEL_TH[region]).join(' · ');
}

export function parseCategory(value: string | null | undefined): CategorySlug | null {
	return CATEGORY_SLUGS.find((slug) => slug === value) ?? null;
}

export function parseEdition(value: string | null | undefined): BriefEdition | null {
	return BRIEF_EDITIONS.find((edition) => edition === value) ?? null;
}

/** `YYYY-MM-DD` that is also a real calendar day. */
export function isBriefDate(value: string | null | undefined): value is BriefDate {
	const match = BRIEF_DATE_PATTERN.exec(value ?? '');
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

export function isYearMonth(value: string | null | undefined): value is YearMonth {
	const match = YEAR_MONTH_PATTERN.exec(value ?? '');
	return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

export function monthOf(date: BriefDate): YearMonth {
	return date.slice(0, 7);
}

export function addMonths(month: YearMonth, delta: number): YearMonth {
	const [year, monthNumber] = month.split('-').map(Number) as [number, number];
	const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "13 พ.ย. 2026" (short) or "13 พฤศจิกายน 2026" (long). A BriefDate is read as Bangkok noon. */
export function formatThaiDate(
	value: IsoUtc | BriefDate,
	style: 'short' | 'long' = 'short'
): string {
	return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
		timeZone: TIME_ZONE,
		day: 'numeric',
		month: style,
		year: 'numeric'
	}).format(toInstant(value));
}

/** "07:05 น." in Bangkok time. */
export function formatThaiTime(value: IsoUtc): string {
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: TIME_ZONE,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(toInstant(value));
	return `${time} น.`;
}

/** "13 พ.ย. 2026 · 07:05 น." */
export function formatThaiDateTimeShort(value: IsoUtc): string {
	return `${formatThaiDate(value)} · ${formatThaiTime(value)}`;
}

/** "พฤศจิกายน 2026" */
export function formatThaiMonth(month: YearMonth): string {
	return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
		timeZone: TIME_ZONE,
		month: 'long',
		year: 'numeric'
	}).format(toInstant(`${month}-15`));
}

/** English eyebrow, as in the prototype: "FRIDAY · 13 NOVEMBER 2026". */
export function formatEyebrowDate(date: BriefDate): string {
	const instant = toInstant(date);
	const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'long' }).format(
		instant
	);
	const day = new Intl.DateTimeFormat('en-GB', {
		timeZone: TIME_ZONE,
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(instant);
	return `${weekday} · ${day}`.toUpperCase();
}

export interface CalendarDay {
	date: BriefDate;
	day: number;
}

/** Weeks of a month, Sunday first; `null` pads the first and last week. */
export function monthGrid(month: YearMonth): (CalendarDay | null)[][] {
	const [year, monthNumber] = month.split('-').map(Number) as [number, number];
	const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
	const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

	const cells: (CalendarDay | null)[] = Array.from({ length: firstWeekday }, () => null);
	for (let day = 1; day <= daysInMonth; day++) {
		cells.push({ date: `${month}-${String(day).padStart(2, '0')}`, day });
	}
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks: (CalendarDay | null)[][] = [];
	for (let start = 0; start < cells.length; start += 7) weeks.push(cells.slice(start, start + 7));
	return weeks;
}

function toInstant(value: IsoUtc | BriefDate): Date {
	return new Date(BRIEF_DATE_PATTERN.test(value) ? `${value}T12:00:00+07:00` : value);
}
