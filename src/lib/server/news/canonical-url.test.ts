import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './canonical-url';

describe('canonicalizeUrl', () => {
	it.each([
		[
			'lower-cases scheme and host',
			'HTTPS://News.Example.COM/World/Story',
			'https://news.example.com/World/Story'
		],
		['drops the fragment', 'https://example.com/a#section-2', 'https://example.com/a'],
		['drops the default https port', 'https://example.com:443/a', 'https://example.com/a'],
		[
			'drops the default http port and keeps the scheme',
			'http://example.com:80/a',
			'http://example.com/a'
		],
		['keeps a non-default port', 'https://example.com:8443/a', 'https://example.com:8443/a'],
		[
			'drops utm_* params',
			'https://example.com/a?utm_source=rss&utm_medium=feed&UTM_Campaign=x',
			'https://example.com/a'
		],
		[
			'drops click ids and ref params',
			'https://example.com/a?fbclid=1&gclid=2&dclid=3&mc_cid=4&mc_eid=5&igshid=6&ref=7&ref_src=8&cmpid=9&ocid=10&msclkid=11',
			'https://example.com/a'
		],
		[
			'keeps and sorts meaningful params',
			'https://example.com/a?page=2&id=7&utm_source=x',
			'https://example.com/a?id=7&page=2'
		],
		[
			'strips a trailing slash',
			'https://example.com/world/story/',
			'https://example.com/world/story'
		],
		[
			'strips repeated trailing slashes',
			'https://example.com/world//',
			'https://example.com/world'
		],
		['keeps the root slash', 'https://example.com/', 'https://example.com/'],
		['adds the root slash to a bare host', 'https://example.com', 'https://example.com/'],
		['removes credentials', 'https://user:pass@example.com/a', 'https://example.com/a'],
		['trims surrounding whitespace', '  https://example.com/a  ', 'https://example.com/a'],
		[
			'keeps non-ASCII paths percent-encoded',
			'https://example.com/ข่าว',
			'https://example.com/%E0%B8%82%E0%B9%88%E0%B8%B2%E0%B8%A7'
		]
	])('%s', (_name, input, expected) => {
		expect(canonicalizeUrl(input)).toBe(expected);
	});

	it.each([
		['javascript:alert(1)'],
		['ftp://example.com/file'],
		['data:text/html,hi'],
		['not a url'],
		['']
	])('rejects %j', (input) => {
		expect(canonicalizeUrl(input)).toBeNull();
	});

	it('maps tracking variants of one article to the same key', () => {
		const variants = [
			'https://Example.com/story/?utm_source=a',
			'https://example.com/story?fbclid=xyz#comments',
			'https://example.com:443/story/'
		];
		expect(new Set(variants.map(canonicalizeUrl))).toEqual(new Set(['https://example.com/story']));
	});
});
