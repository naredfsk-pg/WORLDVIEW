import { describe, expect, it } from 'vitest';
import type { RawFeedItem, SourceDefinition } from '#lib/types/news.js';
import { computeContentHash } from './fingerprint';
import {
	cleanFeedText,
	MAX_EXCERPT_LENGTH,
	MAX_TITLE_LENGTH,
	normalizeFeedItem
} from './normalize';

const now = new Date('2026-11-13T00:00:00.000Z');

const source: SourceDefinition = {
	id: 'wire-a',
	name: 'Wire A',
	kind: 'rss',
	homepage_url: 'https://wire-a.example',
	feed_url: 'https://wire-a.example/rss.xml',
	license_notes: 'test',
	allow_excerpt: true,
	is_demo: true,
	enabled: true
};

const raw = (overrides: Partial<RawFeedItem> = {}): RawFeedItem => ({
	link: 'https://wire-a.example/world/story-1/?utm_source=rss',
	title: 'Ceasefire talks resume',
	summary: '<p>Delegations met on <b>Monday</b>.</p>',
	published: 'Thu, 12 Nov 2026 16:59:59 GMT',
	updated: null,
	guid: 'g-1',
	language: 'EN_us',
	author: 'Desk <i>A</i>',
	categories: ['World', 'World', ' Diplomacy '],
	...overrides
});

describe('normalizeFeedItem', () => {
	it('maps a feed item to a normalized article with UTC times kept separate', () => {
		const article = normalizeFeedItem(source, raw(), now);
		expect(article).toEqual({
			source_id: 'wire-a',
			source_url: 'https://wire-a.example/world/story-1/?utm_source=rss',
			canonical_url: 'https://wire-a.example/world/story-1',
			publisher_name: 'Wire A',
			title: 'Ceasefire talks resume',
			excerpt: 'Delegations met on Monday.',
			language: 'en-us',
			published_at: '2026-11-12T16:59:59.000Z',
			ingested_at: '2026-11-13T00:00:00.000Z',
			content_hash: computeContentHash({
				title: 'Ceasefire talks resume',
				excerpt: 'Delegations met on Monday.',
				publisher_name: 'Wire A'
			}),
			raw_metadata: { guid: 'g-1', author: 'Desk A', categories: ['World', 'Diplomacy'] }
		});
	});

	it('stores no excerpt when the source does not allow it', () => {
		const article = normalizeFeedItem({ ...source, allow_excerpt: false }, raw(), now);
		expect(article?.excerpt).toBeNull();
		expect(article?.content_hash).toBe(
			computeContentHash({
				title: 'Ceasefire talks resume',
				excerpt: null,
				publisher_name: 'Wire A'
			})
		);
	});

	it('falls back to `updated`, and never guesses a zone-less time', () => {
		expect(
			normalizeFeedItem(source, raw({ published: null, updated: '2026-11-12T10:00:00Z' }), now)
				?.published_at
		).toBe('2026-11-12T10:00:00.000Z');
		expect(
			normalizeFeedItem(source, raw({ published: '2026-11-12T10:00:00' }), now)?.published_at
		).toBeNull();
	});

	it.each([
		['no link', { link: null }],
		['a javascript: link', { link: 'javascript:alert(1)' }],
		['a relative link', { link: '/world/story' }],
		['a link with credentials', { link: 'https://user:secret@wire-a.example/x' }],
		['an over-long link', { link: `https://wire-a.example/${'a'.repeat(2100)}` }],
		['no title', { title: null }],
		['a title that is only markup', { title: '<img src=x onerror=alert(1)>' }]
	])('drops an item with %s', (_name, overrides) => {
		expect(normalizeFeedItem(source, raw(overrides), now)).toBeNull();
	});

	it('caps title and excerpt lengths', () => {
		const article = normalizeFeedItem(
			source,
			raw({ title: 'ข่าว '.repeat(200), summary: 'word '.repeat(400) }),
			now
		);
		expect(Array.from(article!.title)).toHaveLength(MAX_TITLE_LENGTH);
		expect(article!.title.endsWith('…')).toBe(true);
		expect(Array.from(article!.excerpt!).length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
	});

	it('caps categories before cleaning them', () => {
		const categories = Array.from({ length: 500 }, (_, index) => `c${index} ${'x'.repeat(5_000)}`);
		const article = normalizeFeedItem(source, raw({ categories }), now);
		const kept = article!.raw_metadata['categories'] as string[];
		expect(kept).toHaveLength(20);
		expect(kept.every((category) => Array.from(category).length <= 80)).toBe(true);
	});

	it('drops an invalid language tag', () => {
		expect(
			normalizeFeedItem(source, raw({ language: 'not a language' }), now)?.language
		).toBeNull();
		expect(normalizeFeedItem(source, raw({ language: 'th' }), now)?.language).toBe('th');
	});
});

describe('cleanFeedText (untrusted feed text)', () => {
	it.each([
		['strips tags', '<p>Hello <b>world</b></p>', 'Hello world'],
		[
			'drops script and style contents',
			'a<script>alert("x")</script>b<style>p{}</style>c',
			'a b c'
		],
		['drops comments', 'a<!-- hidden -->b', 'a b'],
		[
			'decodes named and numeric entities',
			'Tom &amp; Jerry &#8217;s &#x41; &nbsp;ok',
			'Tom & Jerry ’s A ok'
		],
		['strips entity-encoded markup', '&lt;b&gt;bold&lt;/b&gt;', 'bold'],
		['keeps a literal less-than', 'a < b and c > d', 'a < b and c > d'],
		['decodes only one level', '&amp;lt;b&amp;gt;', '&lt;b&gt;'],
		['replaces invalid code points', 'x&#xD800;y', 'x�y'],
		['removes control and bidi override characters', 'safe\u0000‮text\u0007', 'safe text'],
		['collapses whitespace', '  many \n\t spaces  ', 'many spaces'],
		['keeps Thai text intact', '<p>ข่าวด่วน&nbsp;วันนี้</p>', 'ข่าวด่วน วันนี้']
	])('%s', (_name, input, expected) => {
		expect(cleanFeedText(input, 500)).toBe(expected);
	});

	it('returns empty for null', () => {
		expect(cleanFeedText(null, 10)).toBe('');
	});
});
