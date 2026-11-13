/** Pure text checks shared by the editorial gates. */

const THAI_SCRIPT = /[฀-๿]/;
/** ARCHITECTURE §11 G3: `https?://` or `www.` anywhere in generated text. */
const URL_LIKE = /https?:\/\/|www\./i;

/** Non-empty after trimming and contains at least one Thai character. */
export function isThaiText(value: string | null | undefined): boolean {
	return typeof value === 'string' && value.trim().length > 0 && THAI_SCRIPT.test(value);
}

export function containsUrl(value: string | null | undefined): boolean {
	return typeof value === 'string' && URL_LIKE.test(value);
}

export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}
