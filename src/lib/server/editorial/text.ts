/** Pure text checks shared by the editorial gates. */

const THAI_SCRIPT = /[฀-๿]/;
/** ARCHITECTURE §11 G3: `https?://` or `www.` anywhere in generated text. */
const URL_LIKE = /https?:\/\/|www\./i;
/**
 * Bare domains such as `evil-news.example.com/x`: dot-separated labels ending in an alphabetic
 * TLD of 2+ letters. `U.S.`, `e.g.`, `2.5` and `1.2.3` do not match (one-letter or numeric last
 * part). Rare dotted names such as `Node.js` do match; that only sends the text to a human.
 */
const BARE_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\b/i;

/** Non-empty after trimming and contains at least one Thai character. */
export function isThaiText(value: string | null | undefined): boolean {
	return typeof value === 'string' && value.trim().length > 0 && THAI_SCRIPT.test(value);
}

export function containsUrl(value: string | null | undefined): boolean {
	return typeof value === 'string' && (URL_LIKE.test(value) || BARE_DOMAIN.test(value));
}

export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}
