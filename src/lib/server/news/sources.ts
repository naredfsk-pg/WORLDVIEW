/**
 * Checked-in source registry (ARCHITECTURE §5, §18 #9): there are no news-API env vars. Ingest
 * upserts the registry into `sources` at the start of every run; sources left out are disabled.
 *
 * On 2026-11-13 the owner approved all six feeds below for headline + link only (PRD §12), so
 * they use `allow_excerpt: false`. Adding a source, or allowing excerpts, needs a new owner
 * approval recorded in `license_notes`.
 *
 * Feed check on 2026-11-13 (one request per URL through SafeFetch): four feeds work and are
 * enabled. Two are approved but disabled until a working URL is found and confirmed:
 * - `who-news`: answers 200, but the feed is stale (83 items, newest 2026-10-10, mostly 2020
 *   stories with re-dated pubDates), so it would only add old news under new dates.
 * - `imf-news`: HTTP 404; `/en/News/RSS` and `/en/Publications/RSS` are 404 too, and imf.org no
 *   longer links an RSS feed.
 */
import type { SourceDefinition } from '#lib/types/news.js';

const OWNER_APPROVAL = 'Owner approved 2026-11-13: headline + link only';

/** Official/public bodies and major outlets with public RSS, all owner-approved (see above). */
export const NEWS_SOURCES: readonly SourceDefinition[] = [
	{
		id: 'un-news',
		name: 'UN News',
		kind: 'rss',
		homepage_url: 'https://news.un.org/en/',
		feed_url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
		license_notes: OWNER_APPROVAL,
		allow_excerpt: false,
		is_demo: false,
		enabled: true
	},
	{
		id: 'who-news',
		name: 'World Health Organization',
		kind: 'rss',
		homepage_url: 'https://www.who.int/news',
		feed_url: 'https://www.who.int/rss-feeds/news-english.xml',
		license_notes: OWNER_APPROVAL,
		allow_excerpt: false,
		is_demo: false,
		enabled: false
	},
	{
		id: 'imf-news',
		name: 'International Monetary Fund',
		kind: 'rss',
		homepage_url: 'https://www.imf.org/en/News',
		feed_url: 'https://www.imf.org/en/News/rss?language=eng',
		license_notes: OWNER_APPROVAL,
		allow_excerpt: false,
		is_demo: false,
		enabled: false
	},
	{
		id: 'bbc-world',
		name: 'BBC News',
		kind: 'rss',
		homepage_url: 'https://www.bbc.com/news/world',
		feed_url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
		license_notes: OWNER_APPROVAL,
		allow_excerpt: false,
		is_demo: false,
		enabled: true
	},
	{
		id: 'guardian-world',
		name: 'The Guardian',
		kind: 'rss',
		homepage_url: 'https://www.theguardian.com/world',
		feed_url: 'https://www.theguardian.com/world/rss',
		license_notes: OWNER_APPROVAL,
		allow_excerpt: false,
		is_demo: false,
		enabled: true
	},
	{
		id: 'aljazeera-all',
		name: 'Al Jazeera',
		kind: 'rss',
		homepage_url: 'https://www.aljazeera.com/',
		feed_url: 'https://www.aljazeera.com/xml/rss/all.xml',
		license_notes: OWNER_APPROVAL,
		allow_excerpt: false,
		is_demo: false,
		enabled: true
	}
];

/**
 * Fictional fixture feeds for tests and `npm run job -- ingest --fixtures` (no network).
 * Wire A is RSS 2.0, wire B is Atom (excerpts not allowed), wire C is RSS with a Thai story.
 */
export const FIXTURE_SOURCES: readonly SourceDefinition[] = [
	fixtureSource('a', 'Fixture Wire A', true),
	fixtureSource('b', 'Fixture Wire B', false),
	fixtureSource('c', 'Fixture Wire C', true)
];

/**
 * The registry for one ingest run. `fixtures` enables only the fixture sources; real candidates
 * stay registered (disabled) so their rows keep their metadata.
 */
export function sourceRegistryFor(mode: 'production' | 'fixtures'): SourceDefinition[] {
	if (mode === 'production') return [...NEWS_SOURCES];
	return [...FIXTURE_SOURCES, ...NEWS_SOURCES.map((source) => ({ ...source, enabled: false }))];
}

function fixtureSource(letter: string, name: string, allowExcerpt: boolean): SourceDefinition {
	return {
		id: `fixture-wire-${letter}`,
		name,
		kind: 'fixture',
		homepage_url: `https://fixtures.worldview.invalid/wire-${letter}`,
		feed_url: `tests/fixtures/feeds/wire-${letter}.xml`,
		license_notes: 'Fictional test fixture; not real news.',
		allow_excerpt: allowExcerpt,
		is_demo: true,
		enabled: true
	};
}
