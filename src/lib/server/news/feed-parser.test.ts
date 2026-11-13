import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NewsFetchError } from './errors';
import { MAX_ITEMS_PER_FEED, parseFeed } from './feed-parser';

const fixture = (name: string) =>
	readFileSync(new URL(`../../../../tests/fixtures/feeds/${name}`, import.meta.url), 'utf8');

describe('parseFeed: RSS 2.0', () => {
	it('parses items, keeps HTML for normalization, and never reads content:encoded', () => {
		const items = parseFeed(fixture('wire-a.xml'));
		expect(items).toHaveLength(4);
		expect(items[0]).toEqual({
			link: 'https://Fixtures.Worldview.invalid/wire-a/2026/11/kessel-accord/?utm_source=rss&utm_medium=feed#top',
			title: 'Avalor and Meridia sign Kessel River water-sharing accord',
			summary: expect.stringContaining('<b>fictional</b>'),
			published: 'Thu, 12 Nov 2026 16:30:00 GMT',
			updated: null,
			guid: 'wire-a-1001',
			language: 'en',
			author: 'Desk A',
			categories: ['Avalor', 'Water']
		});
		expect(JSON.stringify(items)).not.toContain('FULL ARTICLE TEXT');
		expect(items[1]!.summary).toBe('Policymakers cited <em>stable</em> inflation & steady growth.');
		expect(items[2]!.link).toBeNull();
	});

	it('reads Thai items and the item language', () => {
		const thai = parseFeed(fixture('wire-c.xml'))[1]!;
		expect(thai.title).toBe('เทศกาลโคมไฟแห่งเมืองเวลลาเปิดฉากอย่างยิ่งใหญ่');
		expect(thai.language).toBe('th');
		expect(thai.categories).toEqual(['วัฒนธรรม']);
	});
});

describe('parseFeed: Atom', () => {
	it('uses the alternate link, published/updated and summary', () => {
		const items = parseFeed(fixture('wire-b.xml'));
		expect(items).toHaveLength(3);
		expect(items[0]).toMatchObject({
			link: 'https://fixtures.worldview.invalid/wire-b/world/kessel-river-accord/',
			title: 'Kessel River water-sharing accord signed by Avalor and Meridia',
			published: '2026-11-12T17:05:00Z',
			updated: '2026-11-12T17:20:00Z',
			guid: 'urn:fixture:wire-b:2001',
			language: 'en',
			author: 'Desk B',
			categories: ['Water']
		});
		// A link without rel is the alternate link.
		expect(items[1]!.link).toBe(
			'https://fixtures.worldview.invalid/wire-a/2026/11/northland-rate?fbclid=abc123'
		);
	});

	it('flattens xhtml titles to their text (mixed-content word order is not guaranteed)', () => {
		const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Hello <b>there</b></div></title><link href="https://x.example/1"/></entry></feed>`;
		const title = parseFeed(xml)[0]!.title!;
		expect(title.split(' ').sort()).toEqual(['Hello', 'there']);
	});
});

describe('parseFeed: RSS 1.0 (RDF)', () => {
	it('parses items next to the channel', () => {
		const xml = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://x.example/"><title>X</title><dc:language>en</dc:language></channel>
  <item rdf:about="https://x.example/1"><title>One</title><link>https://x.example/1</link><dc:date>2026-11-12T10:00:00Z</dc:date></item>
</rdf:RDF>`;
		expect(parseFeed(xml)).toEqual([
			{
				link: 'https://x.example/1',
				title: 'One',
				summary: null,
				published: '2026-11-12T10:00:00Z',
				updated: null,
				guid: 'https://x.example/1',
				language: 'en',
				author: null,
				categories: []
			}
		]);
	});
});

describe('parseFeed: untrusted and malformed input', () => {
	const expectParseError = (xml: string, message: RegExp) => {
		let thrown: unknown;
		try {
			parseFeed(xml);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(NewsFetchError);
		expect(thrown).toMatchObject({ kind: 'parse_error', retryable: false });
		expect((thrown as Error).message).toMatch(message);
	};

	it('rejects malformed XML', () => {
		expectParseError(fixture('malformed.xml'), /malformed/);
		expectParseError('<rss><channel><item><title>x</title></channel></rss>', /malformed/);
		expectParseError('', /malformed|not an RSS/);
	});

	it('rejects DOCTYPE (no custom entities, no entity expansion attacks)', () => {
		const billionLaughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><rss><channel><item><title>&lol2;</title></item></channel></rss>`;
		expectParseError(billionLaughs, /DOCTYPE/);
		const external = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&x;</title></item></channel></rss>`;
		expectParseError(external, /DOCTYPE/);
	});

	it('rejects well-formed XML that is not a feed', () => {
		expectParseError('<html><body>hi</body></html>', /not an RSS or Atom feed/);
		expectParseError('<rss version="2.0"></rss>', /no channel/);
	});

	it('handles a byte-order mark and an empty channel', () => {
		expect(parseFeed('﻿<rss><channel><title>x</title></channel></rss>')).toEqual([]);
	});

	it(`caps the number of items at ${MAX_ITEMS_PER_FEED}`, () => {
		const items = Array.from(
			{ length: MAX_ITEMS_PER_FEED + 5 },
			(_, index) => `<item><title>t${index}</title><link>https://x.example/${index}</link></item>`
		).join('');
		expect(parseFeed(`<rss><channel>${items}</channel></rss>`)).toHaveLength(MAX_ITEMS_PER_FEED);
	});
});
