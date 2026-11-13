import { describe, expect, it } from 'vitest';
import type { EventGateInput } from '../../types/editorial';
import {
	LINKED_ARTICLES,
	makeArticle,
	REF_TO_ARTICLE_ID,
	VALID_EXTRACTION,
	VALID_SUMMARY
} from '../llm/test-fixtures';
import {
	countDistinctSources,
	evaluateEventForPublish,
	mapRefsToArticleIds,
	reviewReasonForLlmError
} from './event-gate';

function gateInput(overrides: Partial<EventGateInput> = {}): EventGateInput {
	return {
		mode: 'auto',
		articles: LINKED_ARTICLES,
		ref_to_article_id: REF_TO_ARTICLE_ID,
		extraction: VALID_EXTRACTION,
		summary: VALID_SUMMARY,
		signals: { impact_breadth: 1, thailand_relevance: 0, sensitive: false },
		category: 'economy',
		current_status: 'draft',
		auto_publish: 'all',
		...overrides
	};
}

describe('evaluateEventForPublish (auto-publish policy)', () => {
	const oneSource = [
		LINKED_ARTICLES[0]!,
		makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
	];

	it('off (and an omitted policy): an event that passes every gate waits for an admin', () => {
		for (const input of [
			gateInput({ auto_publish: 'off' }),
			gateInput({ auto_publish: undefined })
		]) {
			expect(evaluateEventForPublish(input)).toEqual({
				status: 'pending_review',
				review_reasons: ['auto_publish_disabled']
			});
		}
	});

	it('multi_source: publishes only with two registry sources', () => {
		expect(evaluateEventForPublish(gateInput({ auto_publish: 'multi_source' })).status).toBe(
			'published'
		);
		expect(
			evaluateEventForPublish(gateInput({ auto_publish: 'multi_source', articles: oneSource }))
		).toEqual({ status: 'pending_review', review_reasons: ['auto_publish_disabled'] });
	});

	it('multi_source counts registry sources, not publisher names a feed can choose', () => {
		const twoNamesOneSource = [
			LINKED_ARTICLES[0]!,
			makeArticle({ id: 'art-2', publisher_name: 'Other Outlet', source_name: 'Other Outlet' })
		];
		expect(countDistinctSources(twoNamesOneSource)).toBe(1);
		expect(
			evaluateEventForPublish(
				gateInput({ auto_publish: 'multi_source', articles: twoNamesOneSource })
			).review_reasons
		).toEqual(['auto_publish_disabled']);
	});

	it('only adds auto_publish_disabled when every gate passed', () => {
		const withUrl = { ...VALID_SUMMARY, background_th: 'อ่านต่อ www.example.com' };
		expect(
			evaluateEventForPublish(gateInput({ auto_publish: 'off', summary: withUrl })).review_reasons
		).toEqual(['url_in_generated_text']);
	});

	it('admin publish ignores the policy', () => {
		expect(
			evaluateEventForPublish(gateInput({ mode: 'admin', auto_publish: 'off' })).review_reasons
		).toEqual([]);
	});
});

describe('evaluateEventForPublish (auto)', () => {
	it('publishes when every gate passes', () => {
		expect(evaluateEventForPublish(gateInput())).toEqual({
			status: 'published',
			review_reasons: []
		});
	});

	it('G1: needs a linked stored article with an http(s) URL', () => {
		expect(evaluateEventForPublish(gateInput({ articles: [] })).review_reasons).toContain(
			'no_source'
		);
		const ftp = [makeArticle({ canonical_url: 'ftp://files.example.org/x' })];
		expect(evaluateEventForPublish(gateInput({ articles: ftp })).review_reasons).toContain(
			'no_source'
		);
	});

	it('G2: requires Thai text in the four main fields and a category', () => {
		const english = { ...VALID_SUMMARY, why_it_matters_th: 'Shipping may recover.' };
		const empty = { ...VALID_SUMMARY, title_th: '   ' };

		for (const input of [
			gateInput({ summary: english }),
			gateInput({ summary: empty }),
			gateInput({ category: null })
		]) {
			expect(evaluateEventForPublish(input)).toEqual({
				status: 'pending_review',
				review_reasons: ['missing_thai_fields']
			});
		}
	});

	it('G3: rejects URLs anywhere in generated text, including claims', () => {
		const inBackground = { ...VALID_SUMMARY, background_th: 'ข้อมูลเพิ่มเติม www.example.com' };
		const inClaim = {
			...VALID_SUMMARY,
			claims_th: [{ claimant_th: 'การท่าเรือ', claim_th: 'อ่านที่ http://x.example', evidence: ['a1'] }]
		};

		expect(evaluateEventForPublish(gateInput({ summary: inBackground })).review_reasons).toEqual([
			'url_in_generated_text'
		]);
		expect(evaluateEventForPublish(gateInput({ summary: inClaim })).review_reasons).toEqual([
			'url_in_generated_text'
		]);
	});

	it('G3: rejects obfuscated URLs and contact baiting (auto and admin)', () => {
		const obfuscated = { ...VALID_SUMMARY, summary_th: 'อ่านเพิ่มที่ evil[.]com และ evil\u{3002}com' };
		const contact = { ...VALID_SUMMARY, why_it_matters_th: 'สอบถามโทร 081-234-5678 หรือไลน์ @scam' };
		for (const mode of ['auto', 'admin'] as const) {
			expect(
				evaluateEventForPublish(gateInput({ mode, summary: obfuscated })).review_reasons
			).toEqual(['url_in_generated_text']);
			expect(evaluateEventForPublish(gateInput({ mode, summary: contact })).review_reasons).toEqual(
				['contact_in_generated_text']
			);
		}
	});

	it('G3 checks update_th only for a published event (the only place it is used)', () => {
		const inUpdate = { ...VALID_SUMMARY, update_th: 'อัปเดตจาก evil-news.example.com/x' };
		// A draft has no previous text, so its update_th is ignored, URL or not.
		expect(evaluateEventForPublish(gateInput({ summary: inUpdate }))).toEqual({
			status: 'published',
			review_reasons: []
		});
		expect(
			evaluateEventForPublish(gateInput({ summary: inUpdate, current_status: 'published' }))
		).toEqual({ status: 'keep_published', review_reasons: ['url_in_generated_text'] });
	});

	it('G4: a missing LLM output gives only the LLM reason, so the digest can retry', () => {
		expect(evaluateEventForPublish(gateInput({ summary: null }))).toEqual({
			status: 'pending_review',
			review_reasons: ['llm_failed']
		});
		expect(
			evaluateEventForPublish(gateInput({ extraction: null, llm_error_kind: 'budget_exceeded' }))
		).toEqual({ status: 'pending_review', review_reasons: ['llm_failed'] });
		expect(
			evaluateEventForPublish(gateInput({ summary: null, llm_error_kind: 'invalid_output' }))
		).toEqual({ status: 'pending_review', review_reasons: ['invalid_llm_output'] });
	});

	it('G5: rejects hallucinated refs and refs that map outside the stored articles', () => {
		const hallucinated = { ...VALID_SUMMARY, cited_refs: ['a1', 'a7'] };
		expect(evaluateEventForPublish(gateInput({ summary: hallucinated })).review_reasons).toEqual([
			'invalid_llm_output'
		]);

		const foreign = gateInput({ ref_to_article_id: { a1: 'art-1', a2: 'art-from-another-event' } });
		expect(evaluateEventForPublish(foreign).review_reasons).toEqual(['invalid_llm_output']);
	});

	it('G5: flags facts, claims or citations without evidence as unsupported', () => {
		const noFactEvidence = {
			...VALID_EXTRACTION,
			facts: [{ text: 'Harbour reopened.', evidence: [] }]
		};
		const noCitations = { ...VALID_SUMMARY, cited_refs: [] };

		expect(
			evaluateEventForPublish(gateInput({ extraction: noFactEvidence })).review_reasons
		).toEqual(['unsupported_claim']);
		expect(evaluateEventForPublish(gateInput({ summary: noCitations })).review_reasons).toEqual([
			'unsupported_claim'
		]);
	});

	it('G6: a sensitive single-source event needs review; two publishers pass', () => {
		const sensitive = {
			impact_breadth: 2 as const,
			thailand_relevance: 1 as const,
			sensitive: true
		};
		const singleSource = [
			LINKED_ARTICLES[0]!,
			makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
		];

		expect(
			evaluateEventForPublish(gateInput({ signals: sensitive, articles: singleSource }))
				.review_reasons
		).toEqual(['sensitive_single_source']);
		expect(evaluateEventForPublish(gateInput({ signals: sensitive })).status).toBe('published');
	});

	it('G6: a fresh sensitive extraction wins over stale non-sensitive signals', () => {
		const staleSignals = {
			impact_breadth: 1 as const,
			thailand_relevance: 0 as const,
			sensitive: false
		};
		const singleSource = [
			LINKED_ARTICLES[0]!,
			makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
		];

		expect(
			evaluateEventForPublish(
				gateInput({
					signals: staleSignals,
					extraction: { ...VALID_EXTRACTION, sensitive: true },
					articles: singleSource
				})
			).review_reasons
		).toEqual(['sensitive_single_source']);
	});

	it('never auto-publishes a hidden event: keep_hidden', () => {
		expect(evaluateEventForPublish(gateInput({ current_status: 'hidden' }))).toEqual({
			status: 'keep_hidden',
			review_reasons: []
		});
		expect(evaluateEventForPublish(gateInput({ current_status: 'hidden', summary: null }))).toEqual(
			{ status: 'keep_hidden', review_reasons: ['llm_failed'] }
		);
	});

	it('keeps possible_duplicate like manual_flag: a flagged draft is never auto-published', () => {
		const flagged = { current_review_reasons: ['possible_duplicate' as const] };
		expect(evaluateEventForPublish(gateInput({ ...flagged, current_status: 'draft' }))).toEqual({
			status: 'pending_review',
			review_reasons: ['possible_duplicate']
		});
		// The admin gate ignores it: publishing the draft as a separate event is the admin's call.
		expect(
			evaluateEventForPublish(
				gateInput({ ...flagged, mode: 'admin', current_status: 'pending_review' })
			)
		).toEqual({ status: 'published', review_reasons: [] });
	});

	it('keeps an admin manual_flag: never auto-published, and not eligible for the llm_failed retry', () => {
		const flagged = { current_review_reasons: ['manual_flag' as const] };

		expect(
			evaluateEventForPublish(gateInput({ ...flagged, current_status: 'pending_review' }))
		).toEqual({ status: 'pending_review', review_reasons: ['manual_flag'] });
		expect(
			evaluateEventForPublish(
				gateInput({ ...flagged, current_status: 'pending_review', summary: null })
			)
		).toEqual({ status: 'pending_review', review_reasons: ['llm_failed', 'manual_flag'] });
		expect(evaluateEventForPublish(gateInput({ ...flagged, current_status: 'published' }))).toEqual(
			{ status: 'keep_published', review_reasons: ['manual_flag'] }
		);
		// Other stored reasons are recomputed, not carried over.
		expect(
			evaluateEventForPublish(
				gateInput({ current_review_reasons: ['llm_failed'], current_status: 'pending_review' })
			).status
		).toBe('published');
	});

	it('routes deterministic LLM failures to a human, not to the automatic retry', () => {
		for (const kind of ['invalid_request', 'input_too_large'] as const) {
			expect(evaluateEventForPublish(gateInput({ summary: null, llm_error_kind: kind }))).toEqual({
				status: 'pending_review',
				review_reasons: ['llm_request_rejected']
			});
		}
	});

	it('publishes a non-sensitive single-source event, which the UI labels via source_count', () => {
		const singleSource = [
			LINKED_ARTICLES[0]!,
			makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
		];

		expect(countDistinctSources(singleSource)).toBe(1);
		expect(countDistinctSources(LINKED_ARTICLES)).toBe(2);
		expect(evaluateEventForPublish(gateInput({ articles: singleSource })).status).toBe('published');
	});

	it('reports every failing reason at once, in a stable order', () => {
		const decision = evaluateEventForPublish(
			gateInput({
				articles: [],
				category: null,
				summary: { ...VALID_SUMMARY, title_th: 'https://x.example', cited_refs: [] }
			})
		);
		expect(decision).toEqual({
			status: 'pending_review',
			review_reasons: [
				'no_source',
				'invalid_llm_output',
				'unsupported_claim',
				'url_in_generated_text',
				'missing_thai_fields'
			]
		});
	});

	it('never auto-demotes a published event: keep_published with the reasons', () => {
		expect(
			evaluateEventForPublish(gateInput({ current_status: 'published', summary: null }))
		).toEqual({
			status: 'keep_published',
			review_reasons: ['llm_failed']
		});
	});
});

describe('evaluateEventForPublish (admin)', () => {
	it('runs only the hard gates G1–G3', () => {
		const adminInput = gateInput({
			mode: 'admin',
			extraction: null,
			signals: { impact_breadth: 1, thailand_relevance: 0, sensitive: true },
			articles: [LINKED_ARTICLES[0]!],
			current_status: 'pending_review'
		});
		expect(evaluateEventForPublish(adminInput)).toEqual({
			status: 'published',
			review_reasons: []
		});
	});

	it('still blocks admin publish without a source, Thai fields, or with a URL', () => {
		expect(
			evaluateEventForPublish(gateInput({ mode: 'admin', articles: [] })).review_reasons
		).toEqual(['no_source']);
		expect(
			evaluateEventForPublish(gateInput({ mode: 'admin', summary: null })).review_reasons
		).toEqual(['missing_thai_fields']);
		const withUrl = { ...VALID_SUMMARY, summary_th: 'ดู https://x.example' };
		expect(
			evaluateEventForPublish(gateInput({ mode: 'admin', summary: withUrl })).review_reasons
		).toEqual(['url_in_generated_text']);
	});
});

describe('helpers', () => {
	it('mapRefsToArticleIds resolves and de-duplicates, or returns null on any unknown ref', () => {
		expect(mapRefsToArticleIds(['a2', 'a1', 'a2'], REF_TO_ARTICLE_ID)).toEqual(['art-2', 'art-1']);
		expect(mapRefsToArticleIds(['a1', 'a3'], REF_TO_ARTICLE_ID)).toBeNull();
		expect(mapRefsToArticleIds([], REF_TO_ARTICLE_ID)).toEqual([]);
	});

	it('mapRefsToArticleIds never resolves a ref through the object prototype', () => {
		// Without the own-property check, `{}['constructor']` would resolve to a function.
		expect(mapRefsToArticleIds(['constructor'], {})).toBeNull();
		expect(mapRefsToArticleIds(['toString'], {})).toBeNull();
		expect(mapRefsToArticleIds(['__proto__'], {})).toBeNull();
	});

	it('reviewReasonForLlmError separates human-review failures from retryable ones', () => {
		expect(reviewReasonForLlmError('invalid_output')).toBe('invalid_llm_output');
		expect(reviewReasonForLlmError('invalid_request')).toBe('llm_request_rejected');
		expect(reviewReasonForLlmError('input_too_large')).toBe('llm_request_rejected');
		for (const kind of [
			'timeout',
			'rate_limited',
			'http_error',
			'budget_exceeded',
			'not_configured',
			undefined
		] as const) {
			expect(reviewReasonForLlmError(kind)).toBe('llm_failed');
		}
	});
});
