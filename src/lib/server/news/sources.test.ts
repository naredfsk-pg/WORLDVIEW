import { describe, expect, it } from 'vitest';
import { NEWS_SOURCES, sourceRegistryFor } from './sources';

describe('source registry', () => {
	it('lists only the six owner-approved feeds, with internal-only excerpts, over https', () => {
		expect(NEWS_SOURCES.map((source) => source.id).sort()).toEqual([
			'aljazeera-all',
			'bbc-world',
			'guardian-world',
			'imf-news',
			'un-news',
			'who-afro-news'
		]);
		for (const source of NEWS_SOURCES) {
			expect(source).toMatchObject({
				kind: 'rss',
				allow_excerpt: true,
				is_demo: false,
				license_notes:
					'Owner approved 2026-11-13: headline + link + excerpt (≤500 chars, internal use: LLM input and admin view; not shown publicly)'
			});
			expect(new URL(source.feed_url).protocol).toBe('https:');
		}
	});

	it('enables the feeds that passed the 2026-11-13 check, and none in fixtures mode', () => {
		const enabled = (mode: 'production' | 'fixtures') =>
			sourceRegistryFor(mode)
				.filter((source) => source.enabled && !source.is_demo)
				.map((source) => source.id)
				.sort();
		expect(enabled('production')).toEqual([
			'aljazeera-all',
			'bbc-world',
			'guardian-world',
			'un-news'
		]);
		expect(enabled('fixtures')).toEqual([]);
	});

	it('gives every source the article hosts it may cite (security review #5)', () => {
		expect(
			Object.fromEntries(NEWS_SOURCES.map((source) => [source.id, source.link_hosts]))
		).toEqual({
			'un-news': ['news.un.org'],
			'who-afro-news': ['www.afro.who.int'],
			'imf-news': ['www.imf.org'],
			'bbc-world': ['www.bbc.co.uk', 'www.bbc.com'],
			'guardian-world': ['www.theguardian.com'],
			'aljazeera-all': ['www.aljazeera.com']
		});
		for (const source of sourceRegistryFor('fixtures')) {
			expect(source.link_hosts.length).toBeGreaterThan(0);
		}
	});
});
