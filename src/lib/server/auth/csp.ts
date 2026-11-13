/**
 * Content-Security-Policy (ARCHITECTURE §4, "Security headers & CSP").
 *
 * `CSP_DIRECTIVES` is the one source for both policies:
 * - Pages: `csp` in vite.config.ts, hash mode. On every rendered page SvelteKit adds the sha256 of
 *   its own inline hydration script (and of any inline `<style>` it renders) to this list.
 * - Every other response (`__data.json`, endpoints, redirects, the static `src/error.html`):
 *   `FALLBACK_CSP`, set by `withSecurityHeaders` when SvelteKit did not set a policy.
 *
 * The two hashes below cover inline code SvelteKit does not hash for us. `csp.test.ts` recomputes
 * them from the files, so editing either inline block fails `npm test` (with the new hash in the
 * message) instead of silently breaking the theme or the error page.
 */
import type { Config } from '@sveltejs/kit/vite';

type CspDirectives = NonNullable<NonNullable<Config['csp']>['directives']>;

/** The no-flash theme `<script>` in `src/app.html`. */
export const APP_THEME_SCRIPT_HASH = 'sha256-vUOaFql8+jbGG5+p4XpFrzzJLwYlz4YgWHVGMcQMs6I=';
/** The inline `<style>` in `src/error.html` (the static page shown when the root layout fails). */
export const ERROR_PAGE_STYLE_HASH = 'sha256-6r+QyF5I6era/ZjzBWLrwLEeH4gDpE6+DltrUZ3Y4h4=';

export const CSP_DIRECTIVES = {
	'default-src': ['self'],
	'script-src': ['self', APP_THEME_SCRIPT_HASH],
	// `<style>` elements: same-origin files or a hash only.
	'style-src': ['self', ERROR_PAGE_STYLE_HASH],
	// `style="…"` attributes only. SSR markup has them (app.html's `display: contents` wrapper,
	// `style:` directives, bits-ui props) and the Svelte runtime sets them with dynamic values,
	// which a hash cannot cover. An attribute cannot hold a selector or a script, and `url()`
	// stays limited by img-src/font-src, so this does not reopen CSS-injection exfiltration.
	'style-src-attr': ['unsafe-inline'],
	'img-src': ['self', 'data:'],
	'font-src': ['self'],
	'connect-src': ['self'],
	'object-src': ['none'],
	'base-uri': ['self'],
	'form-action': ['self'],
	'frame-ancestors': ['none']
} satisfies CspDirectives;

/** Header value in SvelteKit's syntax: keywords and hashes quoted, schemes (`data:`) bare. */
export const FALLBACK_CSP = Object.entries(CSP_DIRECTIVES)
	.map(([name, sources]) => [name, ...sources.map(quoteSource)].join(' '))
	.join('; ');

function quoteSource(source: string): string {
	return source.endsWith(':') ? source : `'${source}'`;
}
