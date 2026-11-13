import { describe, expect, it } from 'vitest';
import { LINKED_ARTICLES, makeArticle } from '../llm/test-fixtures';
import { buildEventUpdate } from './event-update';

const NEW_ARTICLE = makeArticle({
	id: 'art-3',
	canonical_url: 'https://news.example.org/a/3',
	published_at: '2026-11-13T05:00:00.000Z'
});
const OLDER_NEW_ARTICLE = makeArticle({
	id: 'art-4',
	canonical_url: 'https://news.example.org/a/4',
	published_at: null,
	ingested_at: '2026-11-13T04:00:00.000Z'
});
const ARTICLES = [...LINKED_ARTICLES, OLDER_NEW_ARTICLE, NEW_ARTICLE];

describe('buildEventUpdate (timeline entry, G2/G3/G5 checks)', () => {
	it('builds the entry from the Thai line and the newly linked stored articles', () => {
		expect(
			buildEventUpdate({
				update_th: '  ทางการยืนยันตัวเลขผู้ได้รับผลกระทบเพิ่มเติม ',
				evidence_article_ids: ['art-4', 'art-3', 'art-3'],
				articles: ARTICLES
			})
		).toEqual({
			occurred_at: null,
			// The newest evidence: published_at, or ingested_at when the feed gave no time.
			reported_at: '2026-11-13T05:00:00.000Z',
			update_text_th: 'ทางการยืนยันตัวเลขผู้ได้รับผลกระทบเพิ่มเติม',
			evidence_refs: [{ article_id: 'art-4' }, { article_id: 'art-3' }]
		});
	});

	it.each([
		['null text', null],
		['empty text', '  '],
		['text without Thai', 'Officials confirmed more figures'],
		['a URL (G3)', 'อ่านต่อที่ https://x.example'],
		['a bare domain (G3)', 'อ่านต่อที่ evil-news.example.com/x']
	])('writes nothing for %s', (_label, text) => {
		expect(
			buildEventUpdate({ update_th: text, evidence_article_ids: ['art-3'], articles: ARTICLES })
		).toBeNull();
	});

	it('writes nothing without evidence, or with evidence that is not a stored, citable article', () => {
		const text = 'มีรายงานเพิ่มเติม';
		expect(
			buildEventUpdate({ update_th: text, evidence_article_ids: [], articles: ARTICLES })
		).toBe(null);
		expect(
			buildEventUpdate({ update_th: text, evidence_article_ids: ['unknown'], articles: ARTICLES })
		).toBeNull();
		const notHttp = makeArticle({ id: 'art-5', canonical_url: 'javascript:alert(1)' });
		expect(
			buildEventUpdate({
				update_th: text,
				evidence_article_ids: ['art-5'],
				articles: [...ARTICLES, notHttp]
			})
		).toBeNull();
	});
});
