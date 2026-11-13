import { describe, expect, it } from 'vitest';
import type { RawFeedItem, SourceDefinition } from '#lib/types/news.js';
import { computeContentHash } from './fingerprint';
import {
	cleanFeedText,
	MAX_EXCERPT_LENGTH,
	MAX_TITLE_LENGTH,
	normalizeFeedItem,
	stripFeedBoilerplate
} from './normalize';

const now = new Date('2026-11-13T00:00:00.000Z');
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const CONTROL_NUL = String.fromCharCode(0x00);
const CONTROL_BEL = String.fromCharCode(0x07);
const RLO = String.fromCharCode(0x202e);

const source: SourceDefinition = {
	id: 'wire-a',
	name: 'Wire A',
	kind: 'rss',
	homepage_url: 'https://wire-a.example',
	feed_url: 'https://wire-a.example/rss.xml',
	license_notes: 'test',
	allow_excerpt: true,
	is_demo: true,
	enabled: true,
	link_hosts: ['wire-a.example']
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

	it('stores source_url as the serialized URL, not the raw feed string', () => {
		const article = normalizeFeedItem(
			source,
			raw({ link: ' HTTPS://Wire-A.example/ข่าว/a b?q=1 ' }),
			now
		);
		expect(article?.source_url).toBe(
			'https://wire-a.example/%E0%B8%82%E0%B9%88%E0%B8%B2%E0%B8%A7/a%20b?q=1'
		);
	});

	it('cleans the guid like other feed text (controls and bidi characters removed)', () => {
		const guid = `  id${RLO}-1${CONTROL_NUL}  `;
		expect(normalizeFeedItem(source, raw({ guid }), now)?.raw_metadata['guid']).toBe('id-1');
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
		['replaces invalid code points', 'x&#xD800;y', `x${REPLACEMENT_CHAR}y`],
		[
			'removes control and bidi override characters',
			`safe${CONTROL_NUL}${RLO}text${CONTROL_BEL}`,
			'safe text'
		],
		['collapses whitespace', '  many \n\t spaces  ', 'many spaces'],
		['keeps Thai text intact', '<p>ข่าวด่วน&nbsp;วันนี้</p>', 'ข่าวด่วน วันนี้']
	])('%s', (_name, input, expected) => {
		expect(cleanFeedText(input, 500)).toBe(expected);
	});

	it('removes every invisible format character and keeps Thai text intact', () => {
		const invisible = [
			0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
			0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff
		].map((codePoint) => String.fromCharCode(codePoint));
		for (const char of invisible) {
			expect(cleanFeedText(`ข่าว${char}ด่วน`, 100)).toBe('ข่าวด่วน');
		}
		// Thai vowels and tone marks (combining marks) are not format characters.
		expect(cleanFeedText('น้ำท่วมเชียงใหม่ ไม่ใช่ข่าวปลอม', 100)).toBe('น้ำท่วมเชียงใหม่ ไม่ใช่ข่าวปลอม');
	});

	it('returns empty for null', () => {
		expect(cleanFeedText(null, 10)).toBe('');
	});
});

/** Excerpt as stored: boilerplate stripped, then the usual cleanup and the 500-char cap. */
const excerptOf = (summary: string) =>
	normalizeFeedItem(source, raw({ summary }), now)?.excerpt ?? null;
const GU = 'https://www.theguardian.com';

describe('feed boilerplate in excerpts (Guardian-shaped samples)', () => {
	it('drops a live-blog navigation list and the trailing "Continue reading..." link', () => {
		const summary =
			'<p>Former chief executive and the commerce secretary are expected to appear before Congress</p>' +
			`<ul><li><p> <a href="${GU}/technology/live/2026/nov/13/chip-maker-live">Chip maker scandal – latest updates</a></p></li>` +
			`<li><p><a href="${GU}/technology/2026/nov/12/analysis">Analysis: The founder built an AI kingdom. Will its walls hold?</a></p></li></ul>` +
			'<p>The ousted chief executive is expected to testify in the coming weeks, as the fallout spreads.</p>' +
			` <a href="${GU}/technology/2026/nov/13/story">Continue reading...</a>`;
		expect(excerptOf(summary)).toBe(
			'Former chief executive and the commerce secretary are expected to appear before Congress ' +
				'The ousted chief executive is expected to testify in the coming weeks, as the fallout spreads.'
		);
	});

	it('drops "Full report: … Analysis: … Explainer: …" items labelled inside the link', () => {
		const summary =
			'<p>Rescue teams reach the flooded valley.</p><ul>' +
			`<li><a href="${GU}/world/a">Full report: Floods cut off mountain towns</a></li>` +
			`<li><p><a href="${GU}/world/b">Analysis: Why the valley floods every decade</a></p></li>` +
			`<li><p><a href="${GU}/world/c">Explainer: How flood warnings work</a></p></li>` +
			`<li><a href="${GU}/world/d">Floods – live</a></li></ul>` +
			'<p>Officials said 40 villages were cut off.</p>';
		expect(excerptOf(summary)).toBe(
			'Rescue teams reach the flooded valley. Officials said 40 villages were cut off.'
		);
	});

	it('keeps link-only headlines (English or Thai) and a label outside a link to a sentence (review L10)', () => {
		const summary =
			`<ul><li><a href="${GU}/x">Thailand floods kill 12 in Chiang Mai</a></li>` +
			`<li><a href="${GU}/y">สรุปข่าวน้ำท่วมภาคเหนือ</a></li>` +
			`<li>Analysis: <a href="${GU}/z">Why the valley floods every decade</a></li></ul>` +
			`<p>Analysis: <a href="${GU}/w">The ceasefire held overnight, officials said</a></p>` +
			`<p><a href="${GU}/v">Read more</a> about the summit: leaders agreed a deal.</p>`;
		expect(excerptOf(summary)).toBe(
			'Thailand floods kill 12 in Chiang Mai สรุปข่าวน้ำท่วมภาคเหนือ ' +
				'Analysis: Why the valley floods every decade ' +
				'Analysis: The ceasefire held overnight, officials said ' +
				'Read more about the summit: leaders agreed a deal.'
		);
	});

	it('drops a "Sign up for the … email" link item and a "See also:" paragraph', () => {
		const summary =
			'<p>This live blog is now closed.</p>' +
			`<ul><li><p><a href="${GU}/a">Sign up for the Breaking News US email</a></p></li></ul>` +
			`<p>See also: <a href="${GU}/b">Earlier story</a></p><p>Body text.</p>`;
		expect(excerptOf(summary)).toBe('This live blog is now closed. Body text.');
	});

	it('drops the newsletter promo item and a "Related:" paragraph', () => {
		const summary =
			'<p>Royal commission hears from a contractor employee</p>' +
			`<ul><li><p>Get our <a href="${GU}/email-newsletters">breaking news email</a>, <a href="https://app.example.com/x">free app</a> or <a href="${GU}/podcast">daily news podcast</a></p></li></ul>` +
			`<p>Related: <a href="${GU}/a">Earlier hearing</a>, <a href="${GU}/b">Timeline</a></p>` +
			'<p>The inquiry heard workers were fearful of the union.</p>';
		expect(excerptOf(summary)).toBe(
			'Royal commission hears from a contractor employee The inquiry heard workers were fearful of the union.'
		);
	});

	it('strips the boilerplate before the 500-char cap, so article text survives the cap', () => {
		const longLabel = 'Analysis: ' + 'a very long headline of another story '.repeat(6);
		const summary =
			'<ul>' +
			[1, 2, 3].map((n) => `<li><a href="${GU}/x/${n}">${longLabel}</a></li>`).join('') +
			'</ul><p>The minister resigned on Friday.</p>';
		expect(longLabel.length * 3).toBeGreaterThan(MAX_EXCERPT_LENGTH);
		expect(excerptOf(summary)).toBe('The minister resigned on Friday.');
	});

	it('keeps content lists, link-led sentences and the words "continue reading" inside a sentence', () => {
		const summary =
			'<ul><li><p>Move is a further tightening of current rules</p></li>' +
			`<li><p>Athletes from <a href="${GU}/world/x">two countries</a> are affected</p></li></ul>` +
			`<p><a href="https://festival.example.org">See My World</a>, a day for independent creators, takes place on 21 November.</p>` +
			'<p>Officials said they would continue reading the report... </p>';
		expect(excerptOf(summary)).toBe(
			'Move is a further tightening of current rules Athletes from two countries are affected ' +
				'See My World, a day for independent creators, takes place on 21 November. ' +
				'Officials said they would continue reading the report...'
		);
	});

	it('leaves Thai text and plain English sentences untouched', () => {
		const thai = '<p>รัฐบาลประกาศมาตรการช่วยเหลือผู้ประสบภัยน้ำท่วม อ่านต่อได้ที่หน้าเว็บ</p>';
		const english =
			'Delegations met on Monday. Analysis of the data continues; related talks resume.';
		expect(stripFeedBoilerplate(thai)).toBe(thai);
		expect(stripFeedBoilerplate(english)).toBe(english);
		expect(excerptOf(thai)).toBe('รัฐบาลประกาศมาตรการช่วยเหลือผู้ประสบภัยน้ำท่วม อ่านต่อได้ที่หน้าเว็บ');
	});

	it('removes a bare "Continue reading..." only at the very end', () => {
		expect(stripFeedBoilerplate('<p>The talks ended.</p> Continue reading...')).toBe(
			'<p>The talks ended.</p> '
		);
		expect(stripFeedBoilerplate('<p>Continue reading…</p>')).toBe('<p>');
		expect(stripFeedBoilerplate('Continue reading... the rest')).toBe(
			'Continue reading... the rest'
		);
	});

	it('stays fast on hostile input', () => {
		const hostile = '<li><a>'.repeat(5_000) + '<p><a>'.repeat(5_000);
		const started = performance.now();
		stripFeedBoilerplate(hostile);
		expect(performance.now() - started).toBeLessThan(500);
	});
});
