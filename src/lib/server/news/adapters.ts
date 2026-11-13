/**
 * `NewsSourceAdapter`s (ARCHITECTURE §9): fetch and parse into `RawFeedItem[]` only.
 * - `rss`: RSS 2.0, RSS 1.0 and Atom over `SafeFetch`.
 * - `fixture`: a local XML file under `tests/fixtures/feeds/` (dev/test only; no network).
 */
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { NewsSourceAdapter } from '#lib/types/news.js';
import { NewsFetchError } from './errors.js';
import { parseFeed } from './feed-parser.js';
import { SAFE_FETCH_DEFAULTS } from './safe-fetch.js';

const FEED_ACCEPT =
	'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8';
/** Repo-relative directory a `fixture` source's `feed_url` must point into. */
export const FIXTURE_FEEDS_DIR = 'tests/fixtures/feeds';

export function createRssAdapter(): NewsSourceAdapter {
	return {
		kind: 'rss',
		async fetch(source, ctx) {
			const response = await ctx.safeFetch(source.feed_url, {
				signal: ctx.signal,
				headers: { accept: FEED_ACCEPT }
			});
			const fetchedAt = ctx.now.toISOString();
			// 304 only happens when the caller sent a validator; nothing new to parse.
			if (response.status === 304) return { items: [], fetched_at: fetchedAt };

			const bytes = new Uint8Array(await response.arrayBuffer());
			const xml = decodeFeedBytes(bytes, response.headers.get('content-type'));
			return { items: parseFeed(xml), fetched_at: fetchedAt };
		}
	};
}

/** `repoRoot` is the directory `feed_url` paths are relative to. Paths outside the fixtures dir are refused. */
export function createFixtureAdapter(repoRoot: string): NewsSourceAdapter {
	const fixturesDir = resolve(repoRoot, FIXTURE_FEEDS_DIR);
	return {
		kind: 'fixture',
		async fetch(source, ctx) {
			const path = resolve(repoRoot, source.feed_url);
			const fromFixturesDir = relative(fixturesDir, path);
			const isInside = !fromFixturesDir.startsWith('..') && !isAbsolute(fromFixturesDir);
			if (!isInside || !path.endsWith('.xml')) {
				throw new NewsFetchError({
					kind: 'not_allowed',
					retryable: false,
					status: null,
					message: `fixture path must be an .xml file under ${FIXTURE_FEEDS_DIR}`
				});
			}
			const size = await stat(path)
				.then((info) => info.size)
				.catch(() => null);
			if (size === null) {
				throw new NewsFetchError({
					kind: 'network',
					retryable: false,
					status: null,
					message: 'fixture file not found'
				});
			}
			if (size > SAFE_FETCH_DEFAULTS.maxBodyBytes) {
				throw new NewsFetchError({
					kind: 'too_large',
					retryable: false,
					status: null,
					message: 'fixture file too large'
				});
			}
			const xml = await readFile(path, 'utf8');
			return { items: parseFeed(xml), fetched_at: ctx.now.toISOString() };
		}
	};
}

/**
 * Decodes with the charset from Content-Type, else the XML declaration, else UTF-8.
 * Thai feeds still use TIS-620 / windows-874 sometimes.
 */
export function decodeFeedBytes(bytes: Uint8Array, contentType: string | null): string {
	const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 256));
	const fromDeclaration = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1];
	const charset = fromHeader ?? fromDeclaration ?? 'utf-8';
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		throw new NewsFetchError({
			kind: 'parse_error',
			retryable: false,
			status: null,
			message: `unsupported charset ${charset.slice(0, 40)}`
		});
	}
}
