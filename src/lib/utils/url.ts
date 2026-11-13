/**
 * URL helpers (ARCHITECTURE §1, §9). Pure and isomorphic (the global `URL` only).
 * - `canonicalizeUrl`: the canonical article URL, used for dedup (UNIQUE `articles.canonical_url`) and display.
 * - `isHttpUrl`: the only scheme check for stored and rendered links.
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

/**
 * True only for absolute http(s) URLs. Every external `href` built from data goes through this;
 * anything else (e.g. `javascript:`) is rendered as text, and ingest refuses to store it.
 */
export function isHttpUrl(value: string | null | undefined): value is string {
	if (!value) return false;
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}
