import { describe, expect, it } from 'vitest';
import type { NewsEvent } from '../../types/domain';
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
	evaluateStoredEventForAutoPublish,
	mapRefsToArticleIds,
	reviewReasonForLlmError,
	storedEventGateReasons
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

	it('G6 matrix: policy × sensitive × registry sources', () => {
		const signals = (sensitive: boolean) => ({
			impact_breadth: 2 as const,
			thailand_relevance: 1 as const,
			sensitive
		});
		const singleSource = [
			LINKED_ARTICLES[0]!,
			makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
		];
		const cases = [
			// [policy, sensitive, sources, expected status, expected reasons]
			['all', true, 1, 'published', []],
			['all', true, 2, 'published', []],
			['all', false, 1, 'published', []],
			['multi_source', true, 1, 'pending_review', ['sensitive_single_source']],
			['multi_source', true, 2, 'published', []],
			['multi_source', false, 1, 'pending_review', ['auto_publish_disabled']],
			['multi_source', false, 2, 'published', []],
			['off', true, 1, 'pending_review', ['sensitive_single_source']],
			['off', true, 2, 'pending_review', ['auto_publish_disabled']],
			['off', false, 1, 'pending_review', ['auto_publish_disabled']],
			['off', false, 2, 'pending_review', ['auto_publish_disabled']]
		] as const;
		for (const [policy, sensitive, sources, status, reasons] of cases) {
			const decision = evaluateEventForPublish(
				gateInput({
					auto_publish: policy,
					signals: signals(sensitive),
					articles: sources === 1 ? singleSource : LINKED_ARTICLES
				})
			);
			expect({ policy, sensitive, sources, ...decision }).toEqual({
				policy,
				sensitive,
				sources,
				status,
				review_reasons: reasons
			});
		}
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
					auto_publish: 'multi_source',
					signals: staleSignals,
					extraction: { ...VALID_EXTRACTION, sensitive: true },
					articles: singleSource
				})
			).review_reasons
		).toEqual(['sensitive_single_source']);
	});

	it('all: hard gates still send a sensitive single-source event to review', () => {
		const singleSource = [
			LINKED_ARTICLES[0]!,
			makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
		];
		const decision = evaluateEventForPublish(
			gateInput({
				signals: { impact_breadth: 1, thailand_relevance: 0, sensitive: true },
				articles: singleSource,
				summary: { ...VALID_SUMMARY, background_th: 'อ่านต่อ www.example.com' }
			})
		);
		expect(decision).toEqual({
			status: 'pending_review',
			review_reasons: ['url_in_generated_text']
		});
	});

	it('the credibility reason never blocks an auto publish (assessCredibility drops it)', () => {
		const summary = {
			...VALID_SUMMARY,
			credibility_level: 'unverified' as const,
			credibility_reason_th: 'ดูเพิ่มที่ www.example.com'
		};
		expect(evaluateEventForPublish(gateInput({ summary })).status).toBe('published');
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

describe('evaluateStoredEventForAutoPublish (reevaluate_pending)', () => {
	const singleSource = [
		LINKED_ARTICLES[0]!,
		makeArticle({ id: 'art-2', canonical_url: 'https://news.example.org/a/2' })
	];
	const stored = (overrides: Partial<NewsEvent> = {}): NewsEvent => ({
		id: 'evt-1',
		status: 'pending_review',
		review_reasons: ['sensitive_single_source'],
		title_th: VALID_SUMMARY.title_th,
		summary_th: VALID_SUMMARY.summary_th,
		what_happened_th: VALID_SUMMARY.what_happened_th,
		why_it_matters_th: VALID_SUMMARY.why_it_matters_th,
		background_th: null,
		uncertain_th: 'ไม่แน่ชัด',
		claims: [{ claimant_th: 'การท่าเรือ', claim_th: 'ความเสียหายมีเพียงเล็กน้อย', evidence_refs: [] }],
		category: 'economy',
		regions: ['asia'],
		countries: [],
		tags: [],
		signals: { impact_breadth: 1, thailand_relevance: 0, sensitive: true },
		occurred_at: null,
		first_seen_at: '2026-11-13T00:00:00.000Z',
		event_date: '2026-11-13',
		last_updated_at: '2026-11-13T00:00:00.000Z',
		published_at: null,
		summarized_at: '2026-11-13T00:10:00.000Z',
		source_count: 1,
		is_demo: false,
		credibility_level: 'none',
		credibility_reason_th: null,
		created_at: '2026-11-13T00:00:00.000Z',
		updated_at: '2026-11-13T00:10:00.000Z',
		...overrides
	});

	it('all: a sensitive single-source event held by G6 is published', () => {
		expect(
			evaluateStoredEventForAutoPublish({
				event: stored(),
				articles: singleSource,
				auto_publish: 'all'
			})
		).toEqual({ status: 'published', review_reasons: [] });
	});

	it('multi_source / off keep the policy reasons', () => {
		expect(
			evaluateStoredEventForAutoPublish({
				event: stored(),
				articles: singleSource,
				auto_publish: 'multi_source'
			}).review_reasons
		).toEqual(['sensitive_single_source']);
		expect(
			evaluateStoredEventForAutoPublish({
				event: stored({ signals: { impact_breadth: 1, thailand_relevance: 0, sensitive: false } }),
				articles: LINKED_ARTICLES,
				auto_publish: 'off'
			}).review_reasons
		).toEqual(['auto_publish_disabled']);
	});

	it('stored text failing G1–G3 stays pending with the real reasons', () => {
		const decision = evaluateStoredEventForAutoPublish({
			event: stored({ summary_th: 'โทร 081-234-5678', category: null }),
			articles: [makeArticle({ canonical_url: 'not a url' })],
			auto_publish: 'all'
		});
		expect(decision).toEqual({
			status: 'pending_review',
			review_reasons: ['no_source', 'contact_in_generated_text', 'missing_thai_fields']
		});
	});

	it('sticky admin reasons are kept', () => {
		expect(
			evaluateStoredEventForAutoPublish({
				event: stored({ review_reasons: ['manual_flag'] }),
				articles: LINKED_ARTICLES,
				auto_publish: 'all'
			}).review_reasons
		).toEqual(['manual_flag']);
	});

	it('storedEventGateReasons (admin publish) checks the credibility reason too', () => {
		expect(
			storedEventGateReasons(
				stored({ credibility_level: 'unverified', credibility_reason_th: 'ดู evil.example.com' }),
				LINKED_ARTICLES
			)
		).toEqual(['url_in_generated_text']);
		expect(storedEventGateReasons(stored(), LINKED_ARTICLES)).toEqual([]);
	});
});
