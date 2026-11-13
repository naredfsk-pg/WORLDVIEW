/**
 * Checked-in source registry (ARCHITECTURE §5, §18 #9): there are no news-API env vars. Ingest
 * upserts the registry into `sources` at the start of every run; sources left out are disabled.
 *
 * Owner approvals (PRD §4.2, §12): on 2026-11-13 the owner approved the six feeds below for
 * headline + link + excerpt (`allow_excerpt: true`). Excerpts are internal only: they are LLM
 * input and shown on the admin event page, but never on public pages or in public DTOs
 * (`SourceRef` has no excerpt field). normalize keeps them HTML-stripped and capped at 500
 * characters. Adding a source, or widening this use, needs a new approval in `license_notes`.
 *
 * Feed checks on 2026-11-13 (one SafeFetch request per URL). A feed is accepted only when it is
 * official, has at least 5 items, its newest item is at most 14 days old, and it does not re-date
 * old stories:
 * - `who-afro-news` (WHO Regional Office for Africa, featured news): 20 items, newest 2026-11-12,
 *   item dates match the article pages. It replaces `who-news`, because no global www.who.int
 *   feed qualifies: `rss-feeds/news-english.xml` is stale (newest 2026-10-10, mostly re-dated
 *   2020 stories), `rss-feeds/feature-stories-english.xml` is 24 days old, and the other WHO feed
 *   paths tried answer 404. **Disabled**: the owner declined a regional-only WHO feed on
 *   2026-11-13; WHO stays off until a working global feed exists.
 * - `imf-news`: disabled. The imf.org RSS paths tried answer 404, and `mediacenter.imf.org/Rss`
 *   works but its newest item is 2026-10-17 (27 days old).
 *
 * `link_hosts` (security wave): the item link hosts seen in the stored feed snapshots of
 * 2026-11-13 (scratchpad `feeds/*.xml`, not fetched again): UN News `news.un.org` (30 of 30
 * items), BBC `www.bbc.co.uk` (33 of 33; `www.bbc.com` is the same outlet's other host and its
 * homepage), Guardian `www.theguardian.com` (45 of 45), Al Jazeera `www.aljazeera.com` (25 of 25).
 * The disabled WHO AFRO and IMF entries use their homepage hosts. Any other host is dropped.
 */
import type { SourceDefinition } from '#lib/types/news.js';

const OWNER_APPROVAL =
	'Owner approved 2026-11-13: headline + link + excerpt (≤500 chars, internal use: LLM input and admin view; not shown publicly)';

/** Official/public bodies and major outlets with public RSS, all owner-approved (see above). */
export const NEWS_SOURCES: readonly SourceDefinition[] = [
	{
		id: 'un-news',
		name: 'UN News',
		kind: 'rss',
		homepage_url: 'https://news.un.org/en/',
		feed_url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
		link_hosts: ['news.un.org'],
		license_notes: OWNER_APPROVAL,
		allow_excerpt: true,
		is_demo: false,
		enabled: true
	},
	{
		id: 'who-afro-news',
		name: 'WHO Regional Office for Africa',
		kind: 'rss',
		homepage_url: 'https://www.afro.who.int/media-centre',
		feed_url: 'https://www.afro.who.int/rss/featured-news.xml',
		link_hosts: ['www.afro.who.int'],
		license_notes: OWNER_APPROVAL,
		allow_excerpt: true,
		is_demo: false,
		enabled: false
	},
	{
		id: 'imf-news',
		name: 'International Monetary Fund',
		kind: 'rss',
		homepage_url: 'https://www.imf.org/en/News',
		feed_url: 'https://www.imf.org/en/News/rss?language=eng',
		link_hosts: ['www.imf.org'],
		license_notes: OWNER_APPROVAL,
		allow_excerpt: true,
		is_demo: false,
		enabled: false
	},
	{
		id: 'bbc-world',
		name: 'BBC News',
		kind: 'rss',
		homepage_url: 'https://www.bbc.com/news/world',
		feed_url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
		link_hosts: ['www.bbc.co.uk', 'www.bbc.com'],
		license_notes: OWNER_APPROVAL,
		allow_excerpt: true,
		is_demo: false,
		enabled: true
	},
	{
		id: 'guardian-world',
		name: 'The Guardian',
		kind: 'rss',
		homepage_url: 'https://www.theguardian.com/world',
		feed_url: 'https://www.theguardian.com/world/rss',
		link_hosts: ['www.theguardian.com'],
		license_notes: OWNER_APPROVAL,
		allow_excerpt: true,
		is_demo: false,
		enabled: true
	},
	{
		id: 'aljazeera-all',
		name: 'Al Jazeera',
		kind: 'rss',
		homepage_url: 'https://www.aljazeera.com/',
		feed_url: 'https://www.aljazeera.com/xml/rss/all.xml',
		link_hosts: ['www.aljazeera.com'],
		license_notes: OWNER_APPROVAL,
		allow_excerpt: true,
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
		link_hosts: ['fixtures.worldview.invalid'],
		license_notes: 'Fictional test fixture; not real news.',
		allow_excerpt: allowExcerpt,
		is_demo: true,
		enabled: true
	};
}
