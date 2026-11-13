import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_THEME_SCRIPT_HASH, CSP_DIRECTIVES, ERROR_PAGE_STYLE_HASH, FALLBACK_CSP } from './csp';

describe('CSP hashes of inline code SvelteKit does not hash', () => {
	it('allows exactly the inline scripts in src/app.html', () => {
		const hashes = inlineBlockHashes(readTemplate('app.html'), 'script');

		// On failure, the received value is the new hash: update APP_THEME_SCRIPT_HASH in csp.ts.
		expect(hashes).toEqual([APP_THEME_SCRIPT_HASH]);
		expect(CSP_DIRECTIVES['script-src']).toContain(APP_THEME_SCRIPT_HASH);
	});

	it('allows the inline style of the static src/error.html, which has no scripts', () => {
		const errorPage = readTemplate('error.html');

		// On failure, the received value is the new hash: update ERROR_PAGE_STYLE_HASH in csp.ts.
		expect(inlineBlockHashes(errorPage, 'style')).toEqual([ERROR_PAGE_STYLE_HASH]);
		expect(CSP_DIRECTIVES['style-src']).toContain(ERROR_PAGE_STYLE_HASH);
		expect(errorPage).not.toMatch(/<script/i);
	});
});

describe('FALLBACK_CSP', () => {
	it('serializes the directives with keywords and hashes quoted', () => {
		expect(FALLBACK_CSP).toBe(
			"default-src 'self'; " +
				`script-src 'self' '${APP_THEME_SCRIPT_HASH}'; ` +
				`style-src 'self' '${ERROR_PAGE_STYLE_HASH}'; style-src-attr 'unsafe-inline'; ` +
				"img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
				"base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
		);
	});

	it("allows 'unsafe-inline' for style attributes only, never for scripts or <style>", () => {
		const unsafe = Object.entries(CSP_DIRECTIVES)
			.filter(([, sources]) => sources.some((source) => source.startsWith('unsafe-')))
			.map(([name]) => name);

		expect(unsafe).toEqual(['style-src-attr']);
		expect(CSP_DIRECTIVES['style-src-attr']).toEqual(['unsafe-inline']);
	});
});

function readTemplate(name: string): string {
	return readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');
}

/**
 * sha256 of each inline `<tag>` block (no `src`), as the browser computes it: over the element's
 * text after the HTML parser has turned CRLF / CR into LF.
 */
function inlineBlockHashes(html: string, tag: 'script' | 'style'): string[] {
	const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
	return [...html.matchAll(pattern)]
		.filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes ?? ''))
		.map(([, , content = '']) => {
			const text = content.replace(/\r\n?/g, '\n');
			return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
		});
}
