/**
 * Canonical article URL (ARCHITECTURE §9), used for dedup (UNIQUE `articles.canonical_url`) and display.
 * The contract places this in `utils/url.ts`; it lives here until that lane adds it (no I/O, pure).
 */

/** Query parameters that only track the click and never identify the article. */
const TRACKING_PARAMS = new Set([
	'fbclid',
	'gclid',
	'dclid',
	'gbraid',
	'wbraid',
	'msclkid',
	'yclid',
	'mc_cid',
	'mc_eid',
	'igshid',
	'ref',
	'ref_src',
	'cmpid',
	'ocid'
]);

/**
 * Returns the canonical form of an http(s) URL, or null when the input is not one.
 * - lower-case scheme and host, drop default ports and any `user:pass@` (done by `URL` / below)
 * - drop the `#fragment`
 * - drop `utm_*` and the params in `TRACKING_PARAMS`, then sort the rest by name (stable)
 * - strip a trailing `/` from the path, except at the root
 */
export function canonicalizeUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

	url.username = '';
	url.password = '';
	url.hash = '';

	const kept = new URLSearchParams();
	for (const [name, value] of url.searchParams) {
		const lowerName = name.toLowerCase();
		if (lowerName.startsWith('utm_') || TRACKING_PARAMS.has(lowerName)) continue;
		kept.append(name, value);
	}
	kept.sort();
	url.search = kept.toString();

	if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
		url.pathname = url.pathname.replace(/\/+$/, '') || '/';
	}
	return url.href;
}
