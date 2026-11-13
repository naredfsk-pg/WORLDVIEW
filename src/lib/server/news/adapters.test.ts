import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FetchContext, SafeFetch, SourceDefinition } from '#lib/types/news.js';
import { createFixtureAdapter, createRssAdapter, decodeFeedBytes } from './adapters';
import { NewsFetchError } from './errors';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const now = new Date('2026-11-13T00:00:00.000Z');

const source = (overrides: Partial<SourceDefinition>): SourceDefinition => ({
	id: 'src',
	name: 'Source',
	kind: 'fixture',
	homepage_url: 'https://src.example',
	feed_url: 'tests/fixtures/feeds/wire-a.xml',
	license_notes: 'test',
	allow_excerpt: true,
	is_demo: true,
	enabled: true,
	link_hosts: [],
	...overrides
});

const context = (safeFetch: SafeFetch): FetchContext => ({
	safeFetch,
	signal: new AbortController().signal,
	now
});

const noNetwork: SafeFetch = async () => {
	throw new Error('network must not be used');
};

describe('fixture adapter', () => {
	it('reads and parses a fixture feed without the network', async () => {
		const result = await createFixtureAdapter(REPO_ROOT).fetch(source({}), context(noNetwork));
		expect(result.items).toHaveLength(4);
		expect(result.fetched_at).toBe('2026-11-13T00:00:00.000Z');
	});

	it.each([
		['path traversal', '../../../../etc/passwd'],
		['traversal out of the fixtures dir', 'tests/fixtures/feeds/../../../package.json'],
		['an absolute path', fileURLToPath(new URL('../../../../package.json', import.meta.url))],
		['a non-xml file', 'tests/fixtures/feeds/notes.txt']
	])('refuses %s', async (_name, feedUrl) => {
		const pending = createFixtureAdapter(REPO_ROOT).fetch(
			source({ feed_url: feedUrl }),
			context(noNetwork)
		);
		await expect(pending).rejects.toMatchObject({ kind: 'not_allowed', retryable: false });
	});

	it('fails a malformed fixture with a non-retryable parse error', async () => {
		const pending = createFixtureAdapter(REPO_ROOT).fetch(
			source({ feed_url: 'tests/fixtures/feeds/malformed.xml' }),
			context(noNetwork)
		);
		await expect(pending).rejects.toBeInstanceOf(NewsFetchError);
		await expect(pending).rejects.toMatchObject({ kind: 'parse_error', retryable: false });
	});
});

describe('rss adapter', () => {
	it('fetches through SafeFetch with the feed Accept header and parses the body', async () => {
		const requested: { url: string; accept: string | undefined }[] = [];
		const safeFetch: SafeFetch = async (url, init) => {
			requested.push({ url, accept: init?.headers?.['accept'] });
			return new Response(
				'<rss><channel><item><title>One</title><link>https://x.example/1</link></item></channel></rss>',
				{ status: 200, headers: { 'content-type': 'application/rss+xml' } }
			);
		};
		const result = await createRssAdapter().fetch(
			source({ kind: 'rss', feed_url: 'https://x.example/rss.xml' }),
			context(safeFetch)
		);
		expect(requested).toEqual([
			{ url: 'https://x.example/rss.xml', accept: expect.stringContaining('application/rss+xml') }
		]);
		expect(result.items.map((item) => item.title)).toEqual(['One']);
	});

	it.each([204, 205, 304])('treats HTTP %i as no new items', async (status) => {
		const safeFetch: SafeFetch = async () => new Response(null, { status });
		const result = await createRssAdapter().fetch(source({ kind: 'rss' }), context(safeFetch));
		expect(result.items).toEqual([]);
		expect(result.not_modified).toBe(status === 304);
	});

	it('sends the stored validators and returns the new ones from a 200', async () => {
		let sent: Record<string, string> | undefined;
		const safeFetch: SafeFetch = async (_url, init) => {
			sent = init?.headers;
			return new Response('<rss><channel><title>Feed</title></channel></rss>', {
				status: 200,
				headers: { etag: '"v2"', 'last-modified': 'Fri, 13 Nov 2026 01:00:00 GMT' }
			});
		};
		const result = await createRssAdapter().fetch(source({ kind: 'rss' }), {
			...context(safeFetch),
			conditional: { etag: '"v1"', last_modified: 'Fri, 13 Nov 2026 00:00:00 GMT' }
		});

		expect(sent).toMatchObject({
			'if-none-match': '"v1"',
			'if-modified-since': 'Fri, 13 Nov 2026 00:00:00 GMT'
		});
		expect(result).toMatchObject({
			not_modified: false,
			validators: { etag: '"v2"', last_modified: 'Fri, 13 Nov 2026 01:00:00 GMT' }
		});
	});

	it('keeps the previous validators on a 304 without headers, and never sends a multi-line value', async () => {
		let sent: Record<string, string> | undefined;
		const safeFetch: SafeFetch = async (_url, init) => {
			sent = init?.headers;
			return new Response(null, { status: 304 });
		};
		const result = await createRssAdapter().fetch(source({ kind: 'rss' }), {
			...context(safeFetch),
			conditional: { etag: '"v1"', last_modified: 'bad\r\nheader' }
		});

		expect(sent?.['if-none-match']).toBe('"v1"');
		expect(sent).not.toHaveProperty('if-modified-since');
		expect(result.validators).toEqual({ etag: '"v1"', last_modified: 'bad\r\nheader' });
	});
});

describe('decodeFeedBytes', () => {
	it('honours a Thai legacy charset from the XML declaration', () => {
		// "ข่าว" in windows-874 / TIS-620.
		const thai = new Uint8Array([0xa2, 0xe8, 0xd2, 0xc7]);
		const head = new TextEncoder().encode('<?xml version="1.0" encoding="windows-874"?><t>');
		const bytes = new Uint8Array([...head, ...thai]);
		expect(decodeFeedBytes(bytes, 'application/xml')).toContain('ข่าว');
	});

	it('prefers the Content-Type charset and defaults to UTF-8', () => {
		const utf8 = new TextEncoder().encode('<t>ข่าว</t>');
		expect(decodeFeedBytes(utf8, null)).toBe('<t>ข่าว</t>');
		expect(decodeFeedBytes(utf8, 'text/xml; charset="utf-8"')).toBe('<t>ข่าว</t>');
	});

	it('lets a byte-order mark win over a wrong Content-Type charset', () => {
		const utf8WithBom = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode('<t>ข่าว</t>')
		]);
		expect(decodeFeedBytes(utf8WithBom, 'text/xml; charset=iso-8859-1')).toBe('<t>ข่าว</t>');
	});

	it('decodes UTF-16 with a byte-order mark', () => {
		const text = '<t>ข่าว</t>';
		const littleEndian = [0xff, 0xfe];
		const bigEndian = [0xfe, 0xff];
		for (const codeUnit of Array.from(text, (char) => char.charCodeAt(0))) {
			littleEndian.push(codeUnit & 0xff, codeUnit >> 8);
			bigEndian.push(codeUnit >> 8, codeUnit & 0xff);
		}
		expect(decodeFeedBytes(new Uint8Array(littleEndian), 'application/xml')).toBe(text);
		expect(decodeFeedBytes(new Uint8Array(bigEndian), null)).toBe(text);
	});

	it('rejects an unknown charset as a parse error', () => {
		expect(() => decodeFeedBytes(new Uint8Array([0x3c]), 'text/xml; charset=x-unknown')).toThrow(
			NewsFetchError
		);
	});
});
