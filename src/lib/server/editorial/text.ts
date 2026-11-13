/**
 * Pure text checks shared by the editorial gates (ARCHITECTURE §11 G3).
 *
 * Generated text is untrusted: a prompt-injected model may hide a link or a scam contact from a
 * plain `https://` check with zero-width or bidi characters, fullwidth letters, `evil[.]com`,
 * `evil . com` or an ideographic full stop. Both checks therefore run on a normalized copy of
 * the text (`normalizeGeneratedText`, lower case, obfuscated dots turned back into `.`).
 * A false positive only sends the text to a human, so the patterns lean towards flagging, but
 * decimals, dates, times, percentages, years and abbreviations such as `U.S.` must pass.
 */
import { normalizeGeneratedText } from '../../utils/text';

const THAI_SCRIPT = /[\u{0E00}-\u{0E7F}]/u;

/** `https?://` or `www.` anywhere. */
const URL_LIKE = /https?:\/\/|www\./u;
/**
 * Bare domains such as `evil-news.example.com/x`: dot-separated labels ending in an alphabetic
 * TLD of 2+ letters. `U.S.`, `e.g.`, `2.5` and `1.2.3` do not match (one-letter or numeric last
 * part). Rare dotted names such as `Node.js` do match; that only sends the text to a human.
 * A match starts only after a non-label character, which keeps `a.a.a.…` linear.
 */
const BARE_DOMAIN = /(?<![a-z0-9.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?![a-z0-9])/u;
/**
 * Thai IDN-like names: a label of 2+ letters, then `.ไทย` or `.คอม` (the Thai-script TLDs).
 * One-letter Thai abbreviations (`พ.ย.`, `ส.ส.ไทย`) do not match.
 */
const THAI_DOMAIN =
	/(?<![\p{L}\p{M}\p{N}-])[\p{L}\p{M}\p{N}-]{2,}\.(?:\u{0E44}\u{0E17}\u{0E22}|\u{0E04}\u{0E2D}\u{0E21})(?![\p{L}\p{M}])/u;

/** Ideographic full stops (U+3002, and the halfwidth U+FF61); NFKC already maps U+FF0E to `.`. */
const IDEOGRAPHIC_DOT = /[\u{3002}\u{FF61}]/gu;
/** `[.]`, `(.)`, `{.}`, `<.>`, `(dot)`, `[จุด]`, `(ดอท)`. */
const BRACKETED_DOT =
	/[([{<]\s*(?:\.|dot|\u{0E08}\u{0E38}\u{0E14}|\u{0E14}\u{0E2D}\u{0E17})\s*[)\]}>]/gu;
/** `evil . com`, `evil .com`: a dot with a space before it is never a sentence end. */
const SPACE_BEFORE_DOT = /\s+\.\s*(?=[a-z0-9])/gu;
/** `evil. com`: a space only after the dot looks like a sentence end, so only for common TLDs. */
const SPACE_AFTER_DOT = /(?<=[a-z0-9])\.\s+(?=(?:com|net|org|info|xyz|io|th)(?![a-z0-9]))/gu;

/** Contact baiting (ARCHITECTURE §11 G3, `contact_in_generated_text`). */
const CONTACT_PATTERNS: readonly RegExp[] = [
	// International numbers: `+66 81 234 5678`, `+1 (202) 555-0143` (8–15 digits).
	/\+\d(?:[\s().-]{0,2}\d){7,14}/u,
	// Thai numbers: `02-123-4567`, `081-234-5678`, `0812345678`. Not part of a longer number,
	// date or time, so `2026-11-13`, `01-11-2026` and `09.30-10.30` pass.
	/(?<![\d.,/:-])0\d{1,2}[\s.-]?\d{3}[\s.-]?\d{3,4}(?![\d.,/:]|-\d)/u,
	// A call-to-action word with a number of 4+ digits: `โทร 1669`, `สายด่วน 1300`, `tel: 1234`.
	/(?<![a-z])(?:\u{0E42}\u{0E17}\u{0E23}(?:\u{0E28}\u{0E31}\u{0E1E}\u{0E17}\u{0E4C})?|\u{0E2A}\u{0E32}\u{0E22}\u{0E14}\u{0E48}\u{0E27}\u{0E19}|tel|phone|whatsapp|wechat|telegram)\.?\s*:?\s*\+?\d(?:[\s-]?\d){3,}/u,
	// LINE ids: `line: scam123`, `line id scam123`, `ไลน์ @scam`, `ไลน์ไอดี scam`.
	/(?<![a-z])line(?:\s*id)?\s*[:=]\s*@?[a-z0-9._-]{3,}/u,
	/(?<![a-z])line\s+id\s+@?[a-z0-9._-]{3,}/u,
	/\u{0E44}\u{0E25}\u{0E19}\u{0E4C}?(?:\s*(?:\u{0E44}\u{0E2D}\u{0E14}\u{0E35}|id))?\s*[:=]?\s*@?[a-z0-9._-]{3,}/u,
	// Handles such as `@scam` (LINE official accounts, social media); e-mail is checked below.
	/(?<![\p{L}\p{N}._%+-])@[a-z0-9._-]{3,}/u,
	// E-mail addresses (the look-behind keeps a long run of name characters linear).
	/(?<![a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/u
];

/** Non-empty after trimming and contains at least one Thai character. */
export function isThaiText(value: string | null | undefined): boolean {
	return typeof value === 'string' && value.trim().length > 0 && THAI_SCRIPT.test(value);
}

/** A URL or domain, also when obfuscated (G3 `url_in_generated_text`). */
export function containsUrl(value: string | null | undefined): boolean {
	if (typeof value !== 'string') return false;
	const text = revealHiddenText(value);
	return URL_LIKE.test(text) || BARE_DOMAIN.test(text) || THAI_DOMAIN.test(text);
}

/** A phone number, LINE id, handle or e-mail address (G3 `contact_in_generated_text`). */
export function containsContact(value: string | null | undefined): boolean {
	if (typeof value !== 'string') return false;
	const text = revealHiddenText(value);
	return CONTACT_PATTERNS.some((pattern) => pattern.test(text));
}

/** The text as a reader sees it: normalized, lower case, obfuscated dots turned back into `.`. */
function revealHiddenText(value: string): string {
	return normalizeGeneratedText(value)
		.toLowerCase()
		.replace(IDEOGRAPHIC_DOT, '.')
		.replace(BRACKETED_DOT, '.')
		.replace(SPACE_BEFORE_DOT, '.')
		.replace(SPACE_AFTER_DOT, '.');
}

/** Either G3 check: for texts that are dropped, not reviewed (relations, lessons, timeline). */
export function containsLinkOrContact(value: string | null | undefined): boolean {
	return containsUrl(value) || containsContact(value);
}
