/**
 * Pure display helpers for the UI: Thai labels, Bangkok-time formatting and the archive month
 * grid. Gregorian year with Thai month names (ARCHITECTURE §7, §18 #11).
 *
 * The date and URL-param helpers live in `#lib/utils` and are re-exported here so components keep
 * one import path. Route loads import them from `#lib/utils` directly.
 */
import {
	CATEGORY_LABEL_TH,
	REGION_LABEL_TH,
	type BriefDate,
	type BriefEdition,
	type CategorySlug,
	type IsoUtc,
	type RegionSlug,
	type RelationType,
	type YearMonth
} from '../types/domain';
import { DEFAULT_TIMEZONE, formatThaiDate, formatThaiTime } from '../utils/date';

export { CREDIBILITY_LABEL_TH } from '../types/domain';
export { formatThaiDate, formatThaiTime, isBriefDate, isYearMonth, monthOf } from '../utils/date';
export { parseCategory, parseEdition, parsePageNumber } from '../utils/params';
export { isHttpUrl } from '../utils/url';

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

export function addMonths(month: YearMonth, delta: number): YearMonth {
	const [year, monthNumber] = month.split('-').map(Number) as [number, number];
	const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "13 พ.ย. 2026 · 07:05 น." */
export function formatThaiDateTimeShort(value: IsoUtc): string {
	return `${formatThaiDate(value)} · ${formatThaiTime(value)}`;
}

/** "พฤศจิกายน 2026" */
export function formatThaiMonth(month: YearMonth): string {
	return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
		timeZone: DEFAULT_TIMEZONE,
		month: 'long',
		year: 'numeric'
	}).format(bangkokNoon(`${month}-15`));
}

/** English eyebrow, as in the prototype: "FRIDAY · 13 NOVEMBER 2026". */
export function formatEyebrowDate(date: BriefDate): string {
	const instant = bangkokNoon(date);
	const weekday = new Intl.DateTimeFormat('en-GB', {
		timeZone: DEFAULT_TIMEZONE,
		weekday: 'long'
	}).format(instant);
	const day = new Intl.DateTimeFormat('en-GB', {
		timeZone: DEFAULT_TIMEZONE,
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

/** A BriefDate is formatted as Bangkok noon, so it never shifts by a day. */
function bangkokNoon(date: BriefDate): Date {
	return new Date(`${date}T12:00:00+07:00`);
}

/** "month=2026-11&date=2026-11-12" from the non-empty values, for `resolve('/archive?…')`. */
export function queryString(params: Record<string, string | null | undefined>): string {
	const entries = Object.entries(params).filter((entry): entry is [string, string] =>
		Boolean(entry[1])
	);
	return new URLSearchParams(entries).toString();
}
