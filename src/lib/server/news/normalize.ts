/**
 * `normalizeFeedItem` (ARCHITECTURE §9): turns one untrusted `RawFeedItem` into a
 * `NormalizedArticle`, or null when the item must be dropped. Pure; `now` is injected.
 * Feed content is data only: HTML is stripped, entities decoded, lengths capped, and full text
 * is never kept (only an excerpt, and only when the source allows it).
 */
import type { JsonObject } from '#lib/types/domain.js';
import type { NormalizedArticle, RawFeedItem, SourceDefinition } from '#lib/types/news.js';
import { canonicalizeUrl } from './canonical-url.js';
import { computeContentHash } from './fingerprint.js';
import { parseFeedTimestamp } from './timestamps.js';

export const MAX_TITLE_LENGTH = 300;
export const MAX_EXCERPT_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_GUID_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 80;
const MAX_CATEGORIES = 20;
/** Raw input is cut before any regex work, so a hostile feed cannot make cleanup slow. */
const MAX_RAW_TEXT_LENGTH = 20_000;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{1,8}){0,3}$/;

export function normalizeFeedItem(
	source: SourceDefinition,
	raw: RawFeedItem,
	now: Date
): NormalizedArticle | null {
	const link = raw.link?.trim() ?? '';
	if (!link || link.length > MAX_URL_LENGTH) return null;
	const canonicalUrl = canonicalizeUrl(link);
	if (!canonicalUrl || hasCredentials(link)) return null;

	const title = cleanFeedText(raw.title, MAX_TITLE_LENGTH);
	if (!title) return null;

	const excerpt = source.allow_excerpt
		? cleanFeedText(raw.summary, MAX_EXCERPT_LENGTH) || null
		: null;
	const publisherName = source.name;

	return {
		source_id: source.id,
		source_url: link,
		canonical_url: canonicalUrl,
		publisher_name: publisherName,
		title,
		excerpt,
		language: normalizeLanguage(raw.language),
		published_at: parseFeedTimestamp(raw.published ?? raw.updated, now),
		ingested_at: now.toISOString(),
		content_hash: computeContentHash({ title, excerpt, publisher_name: publisherName }),
		raw_metadata: buildRawMetadata(raw)
	};
}

/**
 * Plain text from an untrusted feed field: drops script/style blocks, comments and tags, decodes
 * entities (then drops tags that were entity-encoded), removes control and bidi-override
 * characters, collapses whitespace and caps the length. Returns '' for empty input.
 */
export function cleanFeedText(raw: string | null, maxLength: number): string {
	if (!raw) return '';
	const withoutMarkup = stripTags(
		raw
			.slice(0, MAX_RAW_TEXT_LENGTH)
			.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
			.replace(/<!--[\s\S]*?-->/g, ' ')
	);
	const text = stripTags(decodeEntities(withoutMarkup))
		// C0/C1 controls (incl. tab/newline → collapsed below) and bidi overrides/isolates.
		// eslint-disable-next-line no-control-regex -- matching control characters is the point
		.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return truncate(text, maxLength);
}

function hasCredentials(link: string): boolean {
	try {
		const url = new URL(link);
		return url.username !== '' || url.password !== '';
	} catch {
		return true;
	}
}

function normalizeLanguage(raw: string | null): string | null {
	const value = raw?.trim().toLowerCase().replace(/_/g, '-') ?? '';
	return LANGUAGE_TAG.test(value) ? value : null;
}

/** Only the allowed metadata (`guid`, `author`, `categories`); never bodies. */
function buildRawMetadata(raw: RawFeedItem): JsonObject {
	const guid = raw.guid?.trim().slice(0, MAX_GUID_LENGTH) || null;
	const author = cleanFeedText(raw.author, MAX_AUTHOR_LENGTH) || null;
	const categories = [
		...new Set(raw.categories.map((category) => cleanFeedText(category, MAX_CATEGORY_LENGTH)))
	]
		.filter((category) => category !== '')
		.slice(0, MAX_CATEGORIES);
	return { guid, author, categories };
}

const BLOCK_TAG =
	/<\/?(?:p|br|hr|div|section|article|blockquote|h[1-6]|ul|ol|li|table|tr|td|th)\b[^<>]*>/gi;
/** A tag name must start with a letter, so text like "a < b" survives. */
const ANY_TAG = /<\/?[a-zA-Z][^<>]*>/g;

/** Block tags become a space (they separate words); inline tags vanish. */
function stripTags(text: string): string {
	return text.replace(BLOCK_TAG, ' ').replace(ANY_TAG, '');
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	hellip: '…',
	laquo: '«',
	raquo: '»',
	middot: '·',
	bull: '•',
	copy: '©',
	reg: '®',
	trade: '™'
};

/** Single pass, so `&amp;lt;` becomes the text `&lt;`, not `<`. Unknown names are left as-is. */
function decodeEntities(text: string): string {
	return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (match, body: string) => {
		if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? match;
		const isHex = body[1] === 'x' || body[1] === 'X';
		const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
		const isValid =
			codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
		return isValid ? String.fromCodePoint(codePoint) : '�';
	});
}

/** Caps by code points (never splits a surrogate pair) and marks the cut with `…`. */
function truncate(text: string, maxLength: number): string {
	const codePoints = Array.from(text);
	if (codePoints.length <= maxLength) return text;
	return `${codePoints
		.slice(0, maxLength - 1)
		.join('')
		.trimEnd()}…`;
}
