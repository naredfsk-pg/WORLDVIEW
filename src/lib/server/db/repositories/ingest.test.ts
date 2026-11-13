import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedArticle, SourceDefinition } from '../../../types/news';
import type { Db } from '../client';
import { articles } from '../schema';
import { openTestDb } from '../test-db';
import { createIngestRepository } from './ingest';

let db: Db;
let ingest: ReturnType<typeof createIngestRepository>;

const source: SourceDefinition = {
	id: 'test-wire',
	name: 'Test Wire',
	kind: 'fixture',
	homepage_url: 'https://example.com/test',
	feed_url: 'tests/fixtures/feeds/a.xml',
	license_notes: 'test',
	allow_excerpt: true,
	is_demo: true,
	enabled: true
};

const article = (overrides: Partial<NormalizedArticle> = {}): NormalizedArticle => ({
	source_id: 'test-wire',
	source_url: 'https://example.com/test/1?utm_source=x',
	canonical_url: 'https://example.com/test/1',
	publisher_name: 'Test Wire',
	title: 'Ceasefire talks resume',
	excerpt: null,
	language: 'en',
	published_at: '2026-11-12T22:00:00.000Z',
	ingested_at: '2026-11-12T23:00:00.000Z',
	content_hash: 'hash-1',
	raw_metadata: { guid: '1' },
	...overrides
});

beforeEach(async () => {
	db = openTestDb();
	ingest = createIngestRepository(db);
	await ingest.syncSources([source]);
});
afterEach(() => db.$client.close());

describe('IngestRepository', () => {
	it('inserts an article once; the same canonical URL is a duplicate and is never updated', async () => {
		const first = await ingest.insertArticleIfNew(article());
		const second = await ingest.insertArticleIfNew(
			article({ title: 'Changed title', content_hash: 'h2' })
		);

		expect(first.outcome).toBe('inserted');
		expect(second).toEqual({ outcome: 'duplicate_url', article_id: first.article_id });
		const rows = db.select().from(articles).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ title: 'Ceasefire talks resume', taxonomy: null });
	});

	it('dedups the same content hash within 7 days, but not after', async () => {
		const first = await ingest.insertArticleIfNew(article());
		const withinWindow = await ingest.insertArticleIfNew(
			article({
				canonical_url: 'https://example.com/test/2',
				ingested_at: '2026-11-19T22:59:59.000Z'
			})
		);
		const afterWindow = await ingest.insertArticleIfNew(
			article({
				canonical_url: 'https://example.com/test/3',
				ingested_at: '2026-11-19T23:00:01.000Z'
			})
		);

		expect(withinWindow).toEqual({ outcome: 'duplicate_content', article_id: first.article_id });
		expect(afterWindow.outcome).toBe('inserted');
	});

	it('syncSources upserts registry fields and disables sources missing from the registry', async () => {
		await ingest.syncSources([{ ...source, id: 'other', name: 'Other' }]);

		const enabled = await ingest.listEnabledSources();
		expect(enabled.map((row) => row.id)).toEqual(['other']);
	});

	it('records fetch health without touching registry fields', async () => {
		await ingest.recordSourceFetch('test-wire', { ok: true, at: '2026-11-13T00:00:00.000Z' });
		await ingest.recordSourceFetch('test-wire', {
			ok: false,
			at: '2026-11-13T01:00:00.000Z',
			error: 'x'.repeat(1000)
		});

		const [row] = await ingest.listEnabledSources();
		expect(row).toMatchObject({
			name: 'Test Wire',
			last_success_at: '2026-11-13T00:00:00.000Z',
			last_error_at: '2026-11-13T01:00:00.000Z'
		});
		expect(row?.last_error).toHaveLength(300);
	});

	it.each([
		['canonical_url', { canonical_url: 'javascript:alert(1)' }],
		['source_url', { source_url: 'ftp://example.com/test/1' }]
	])('refuses a non-http(s) %s', async (_field, overrides) => {
		await expect(ingest.insertArticleIfNew(article(overrides))).rejects.toThrow(/http\(s\)/);
		expect(db.select().from(articles).all()).toHaveLength(0);
	});

	it('stores the HTTP validators of a successful fetch and keeps them on a failure', async () => {
		await ingest.recordSourceFetch('test-wire', {
			ok: true,
			at: '2026-11-13T00:00:00.000Z',
			validators: { etag: 'W/"abc"', last_modified: 'Fri, 13 Nov 2026 00:00:00 GMT' }
		});
		await ingest.recordSourceFetch('test-wire', {
			ok: false,
			at: '2026-11-13T01:00:00.000Z',
			error: 'timeout'
		});

		const [row] = await ingest.listEnabledSources();
		expect(row).toMatchObject({
			etag: 'W/"abc"',
			last_modified: 'Fri, 13 Nov 2026 00:00:00 GMT'
		});
	});

	it('drops the stored validators when a source moves to a new feed URL', async () => {
		const validators = { etag: '"v1"', last_modified: 'Fri, 13 Nov 2026 00:00:00 GMT' };
		await ingest.recordSourceFetch('test-wire', {
			ok: true,
			at: '2026-11-13T00:00:00.000Z',
			validators
		});

		await ingest.syncSources([source]);
		expect((await ingest.listEnabledSources())[0]).toMatchObject(validators);

		await ingest.syncSources([{ ...source, feed_url: 'tests/fixtures/feeds/b.xml' }]);
		expect((await ingest.listEnabledSources())[0]).toMatchObject({
			etag: null,
			last_modified: null
		});
	});
});
