/**
 * RSS 2.0 / RSS 1.0 (RDF) / Atom → `RawFeedItem[]`. Parses only; no normalization.
 * The XML is untrusted: DOCTYPE (and so custom entities) is rejected before parsing,
 * well-formedness is validated, and the item count is capped.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { RawFeedItem } from '#lib/types/news.js';
import { NewsFetchError } from './errors.js';

export const MAX_ITEMS_PER_FEED = 200;
/** Nested markup inside one field (e.g. Atom `type="xhtml"`) is flattened up to this depth. */
const MAX_TEXT_DEPTH = 8;

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: '#text',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	// Only the five predefined XML entities remain once DOCTYPE is rejected; HTML entities are
	// decoded later by normalization.
	processEntities: true,
	htmlEntities: false,
	isArray: (tagName) => ['item', 'entry', 'link', 'category', 'author'].includes(tagName)
});

export function parseFeed(xml: string): RawFeedItem[] {
	const text = xml.replace(/^\uFEFF/, '');
	if (/<!DOCTYPE/i.test(text)) throw parseError('DOCTYPE is not allowed in feeds');
	if (XMLValidator.validate(text) !== true) throw parseError('malformed XML');

	const document = parser.parse(text) as XmlNode;
	const rss = asNode(document['rss']);
	if (rss) return parseRss(asNode(rss['channel']));
	const atom = asNode(document['feed']);
	if (atom) return parseAtom(atom);
	const rdf = asNode(document['rdf:RDF']);
	if (rdf) return parseRdf(rdf);
	throw parseError('not an RSS or Atom feed');
}

function parseRss(channel: XmlNode | null): RawFeedItem[] {
	if (!channel) throw parseError('RSS feed has no channel');
	const language = textOf(channel['language']);
	return asNodes(channel['item'])
		.slice(0, MAX_ITEMS_PER_FEED)
		.map((item) => ({
			link: firstText(item['link']),
			title: textOf(item['title']),
			// `content:encoded` (full text) is deliberately never read.
			summary: textOf(item['description']),
			published: textOf(item['pubDate']) ?? textOf(item['dc:date']),
			updated: null,
			guid: textOf(item['guid']),
			language: textOf(item['dc:language']) ?? language,
			author: firstText(item['author']) ?? textOf(item['dc:creator']),
			categories: asArray(item['category']).flatMap((category) => textOf(category) ?? [])
		}));
}

function parseAtom(feed: XmlNode): RawFeedItem[] {
	const language = textOf(feed['@_xml:lang']);
	return asNodes(feed['entry'])
		.slice(0, MAX_ITEMS_PER_FEED)
		.map((entry) => ({
			link: atomAlternateLink(entry),
			title: textOf(entry['title']),
			summary: textOf(entry['summary']),
			published: textOf(entry['published']),
			updated: textOf(entry['updated']),
			guid: textOf(entry['id']),
			language: textOf(entry['@_xml:lang']) ?? language,
			author: asNodes(entry['author']).flatMap((author) => textOf(author['name']) ?? [])[0] ?? null,
			categories: asNodes(entry['category']).flatMap((category) => textOf(category['@_term']) ?? [])
		}));
}

function parseRdf(rdf: XmlNode): RawFeedItem[] {
	const language = textOf(asNode(rdf['channel'])?.['dc:language']);
	return asNodes(rdf['item'])
		.slice(0, MAX_ITEMS_PER_FEED)
		.map((item) => ({
			link: firstText(item['link']),
			title: textOf(item['title']),
			summary: textOf(item['description']),
			published: textOf(item['dc:date']),
			updated: null,
			guid: textOf(item['@_rdf:about']),
			language: textOf(item['dc:language']) ?? language,
			author: textOf(item['dc:creator']),
			categories: asArray(item['dc:subject']).flatMap((subject) => textOf(subject) ?? [])
		}));
}

/** Atom `<link rel="alternate" href>`; a link without `rel` means alternate. */
function atomAlternateLink(entry: XmlNode): string | null {
	const links = asNodes(entry['link']);
	const alternate = links.find((link) => {
		const rel = textOf(link['@_rel']);
		return rel === null || rel === 'alternate';
	});
	return textOf(alternate?.['@_href']);
}

/**
 * Text content of a node: a string, or the concatenated text of nested markup (attributes
 * skipped). The parser does not keep mixed-content order, so nested markup (rare: Atom
 * `type="xhtml"`) may come out with its words reordered; plain and CDATA text is exact.
 */
function textOf(value: unknown, depth = 0): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (depth >= MAX_TEXT_DEPTH || value === null || typeof value !== 'object') return null;

	const parts = Object.entries(value as XmlNode)
		.filter(([key]) => !key.startsWith('@_'))
		.flatMap(([, child]) => (Array.isArray(child) ? child : [child]))
		.map((child) => textOf(child, depth + 1))
		.filter((part): part is string => part !== null);
	return parts.length > 0 ? parts.join(' ') : null;
}

function firstText(value: unknown): string | null {
	for (const entry of asArray(value)) {
		const text = textOf(entry);
		if (text) return text;
	}
	return null;
}

function asArray(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function asNodes(value: unknown): XmlNode[] {
	return asArray(value).flatMap((entry): XmlNode[] => {
		const node = asNode(entry);
		return node ? [node] : [];
	});
}

function asNode(value: unknown): XmlNode | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as XmlNode)
		: null;
}

function parseError(message: string): NewsFetchError {
	return new NewsFetchError({ kind: 'parse_error', retryable: false, status: null, message });
}
