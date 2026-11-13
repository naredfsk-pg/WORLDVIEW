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
			'un-news',
			'who-afro-news'
		]);
		expect(enabled('fixtures')).toEqual([]);
	});
});
