/**
 * `normalizeFeedItem` (ARCHITECTURE §9): turns one untrusted `RawFeedItem` into a
 * `NormalizedArticle`, or null when the item must be dropped. Pure; `now` is injected.
 * Feed content is data only: HTML is stripped, entities decoded, lengths capped, and full text
 * is never kept (only an excerpt, and only when the source allows it).
 */
import type { JsonObject } from '#lib/types/domain.js';
import type { NormalizedArticle, RawFeedItem, SourceDefinition } from '#lib/types/news.js';
import { parseFeedTimestamp } from '#lib/utils/date.js';
import { canonicalizeUrl } from '#lib/utils/url.js';
import { computeContentHash } from './fingerprint.js';

export const MAX_TITLE_LENGTH = 300;
export const MAX_EXCERPT_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_GUID_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 80;
const MAX_CATEGORIES = 20;
const MAX_RAW_CATEGORY_LENGTH = 1_000;
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
		? cleanFeedText(stripFeedBoilerplate(raw.summary), MAX_EXCERPT_LENGTH) || null
		: null;
	const publisherName = source.name;

	return {
		source_id: source.id,
		// Serialized by URL (validated, percent-encoded), never the raw feed string.
		source_url: new URL(link).href,
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
	const text = stripInvisible(stripTags(decodeEntities(withoutMarkup)))
		.replace(/\s+/g, ' ')
		.trim();
	return truncate(text, maxLength);
}

/**
 * Removes common feed navigation from an excerpt's HTML, before the length cap, so the cap keeps
 * article text (Wave 3; seen in Guardian descriptions). Conservative: only these shapes go;
 * headlines, sentences and Thai text are never touched:
 * - the trailing "Continue reading..." link (or the same words with an ellipsis at the very end)
 * - list items made only of links whose text is navigation: a label inside the link
 *   ("Full report: …", "Analysis: …", "Explainer: …", "Live: …"), "… – latest updates" /
 *   "… – live", or a bare "Read more" / "See also" / "Sign up …" link
 * - newsletter promos: an item or paragraph of links behind "Get our …" / "Sign up …"
 * - paragraphs of links behind a "Related:" or "See also:" label
 * A link-only item with a real headline ("<a>Floods kill 12 in Chiang Mai</a>") and
 * "Analysis: <a>a sentence</a>" (label outside the link) are kept.
 * Each item is searched within a bounded length, so a hostile feed cannot make it slow.
 */
export function stripFeedBoilerplate(raw: string | null): string {
	if (!raw) return '';
	return raw
		.slice(0, MAX_RAW_TEXT_LENGTH)
		.replace(CONTINUE_READING_LINK, ' ')
		.replace(CONTINUE_READING_AT_END, '$1')
		.replace(LIST_ITEM, (item, inner: string) => (isNavigationListItem(inner) ? ' ' : item))
		.replace(PARAGRAPH, (paragraph, inner: string) =>
			isNavigationParagraph(inner) ? ' ' : paragraph
		);
}

const CONTINUE_READING_LINK =
	/<a\b[^<>]*>\s*Continue reading(?:\.{3}|…|&hellip;|&#8230;)?\s*<\/a\s*>/g;
const CONTINUE_READING_AT_END =
	/(^|[\s>])Continue reading(?:\.{3}|…|&hellip;|&#8230;)\s*(?:<\/[a-z]+\s*>\s*)*$/;
/** Navigation items are short; a longer item is article text and is kept. */
const LIST_ITEM = /<li\b[^<>]*>([\s\S]{0,600}?)<\/li\s*>/gi;
const PARAGRAPH = /<p\b[^<>]*>([\s\S]{0,600}?)<\/p\s*>/gi;
const LINK = /<a\b[^<>]*>[\s\S]*?<\/a\s*>/gi;
/** The only words that may stand outside the links of a navigation item (lower case). */
const RESIDUE_WORDS = new Set([
	'get',
	'our',
	'sign',
	'up',
	'for',
	'to',
	'the',
	'email',
	'newsletter',
	'related',
	'see',
	'also',
	'or',
	'and'
]);
/** Labels outside the links that make the links navigation: promos and related-links lists. */
const BLOCK_LABELS = ['get our', 'sign up', 'related', 'see also'];
/** Link text that is navigation: a label inside the link, a live/updates suffix, a bare label. */
const NAV_LINK_PREFIX = /^(?:full report|analysis|explainer|live|related|opinion)\s*:/i;
const NAV_LINK_SUFFIX = /(?:latest updates|live updates|[-–—]\s*live)$/i;
const NAV_LINK_WHOLE = /^(?:read more|see also|related|live|latest|latest updates|live updates)$/i;
const SIGN_UP_LINK = /^sign up(?: |$)/i;

/** A list item of navigation links only, or a promo / related-links item. */
function isNavigationListItem(inner: string): boolean {
	const parts = splitLinks(inner);
	if (!parts || !isNavigationResidue(parts.residue)) return false;
	return hasBlockLabel(parts.residue) || parts.linkTexts.every(isNavigationLinkText);
}

/** A paragraph needs a label outside its links: a link-only paragraph can be article text. */
function isNavigationParagraph(inner: string): boolean {
	const parts = splitLinks(inner);
	return parts !== null && isNavigationResidue(parts.residue) && hasBlockLabel(parts.residue);
}

/** Link texts and the rest (lower case, letters and digits only); null without a link. */
function splitLinks(inner: string): { linkTexts: string[]; residue: string } | null {
	const links = inner.match(LINK);
	if (!links) return null;
	const residue = plainText(inner.replace(LINK, ' '))
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
	return { linkTexts: links.map(plainText), residue };
}

function plainText(html: string): string {
	return decodeEntities(stripTags(html)).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function isNavigationResidue(residue: string): boolean {
	return residue === '' || residue.split(' ').every((word) => RESIDUE_WORDS.has(word));
}

function hasBlockLabel(residue: string): boolean {
	return BLOCK_LABELS.some((label) => ` ${residue} `.includes(` ${label} `));
}

function isNavigationLinkText(text: string): boolean {
	return (
		NAV_LINK_PREFIX.test(text) ||
		NAV_LINK_SUFFIX.test(text) ||
		NAV_LINK_WHOLE.test(text) ||
		SIGN_UP_LINK.test(text)
	);
}

/**
 * C0/C1 controls (tab/newline included) become a space; invisible format characters vanish:
 * ALM U+061C, ZWSP/ZWNJ/ZWJ/LRM/RLM U+200B–U+200F, bidi embeddings/overrides U+202A–U+202E,
 * word joiner U+2060, bidi isolates U+2066–U+2069 and BOM U+FEFF. Removing ZWSP keeps Thai words
 * joined as displayed; removing ZWJ only splits emoji sequences, which titles do not need.
 */
export function stripInvisible(text: string): string {
	return (
		text
			// eslint-disable-next-line no-control-regex -- matching control characters is the point
			.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
			.replace(INVISIBLE_FORMAT_CHARS, '')
	);
}

const INVISIBLE_FORMAT_CHARS = new RegExp(
	'[' +
		[0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f]
			.concat([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060])
			.concat([0x2066, 0x2067, 0x2068, 0x2069, 0xfeff])
			.map((codePoint) => String.fromCharCode(codePoint))
			.join('') +
		']',
	'g'
);

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
	const guid = cleanFeedText(raw.guid, MAX_GUID_LENGTH) || null;
	const author = cleanFeedText(raw.author, MAX_AUTHOR_LENGTH) || null;
	// Cap the raw input first, so hundreds of hostile categories cost no cleanup work.
	const rawCategories = raw.categories
		.slice(0, MAX_CATEGORIES)
		.map((category) => category.slice(0, MAX_RAW_CATEGORY_LENGTH));
	const categories = [
		...new Set(rawCategories.map((category) => cleanFeedText(category, MAX_CATEGORY_LENGTH)))
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

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

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
		return isValid ? String.fromCodePoint(codePoint) : REPLACEMENT_CHAR;
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
