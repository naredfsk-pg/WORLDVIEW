/**
 * URL-param parsers shared by the route loads and the UI. Pure: unknown values map to null
 * (or the default page), never to an error.
 */
import {
	BRIEF_EDITIONS,
	CATEGORY_SLUGS,
	type BriefEdition,
	type CategorySlug
} from '../types/domain';

export function parseCategory(value: string | null | undefined): CategorySlug | null {
	return CATEGORY_SLUGS.find((slug) => slug === value) ?? null;
}

export function parseEdition(value: string | null | undefined): BriefEdition | null {
	return BRIEF_EDITIONS.find((edition) => edition === value) ?? null;
}

/**
 * Page number from a URL param: a safe integer in [1, max]; anything else is 1, and values past
 * `max` are clamped, so the SQL OFFSET can never overflow.
 */
export function parsePageNumber(value: string | null | undefined, max: number): number {
	const page = Number(value ?? '1');
	if (!Number.isSafeInteger(page) || page < 1) return 1;
	return Math.min(page, max);
}
