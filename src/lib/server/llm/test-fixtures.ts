/** Test-only fixtures for the llm and editorial suites (fictional content, no real news). */
import type {
	ExtractionOutput,
	LlmInput,
	LlmTask,
	SummaryInput,
	SummaryOutput
} from '../../types/llm';
import type { ArticleWithSource } from '../../types/news';

export function makeArticle(overrides: Partial<ArticleWithSource> = {}): ArticleWithSource {
	return {
		id: 'art-1',
		source_id: 'demo-wire',
		source_url: 'https://news.example.org/a/1',
		canonical_url: 'https://news.example.org/a/1',
		publisher_name: 'Demo Wire',
		title: 'Fictional port authority reopens harbour after storm',
		excerpt: 'The fictional harbour of Port Vela reopened on Tuesday, officials said.',
		language: 'en',
		published_at: '2026-11-13T01:00:00.000Z',
		ingested_at: '2026-11-13T01:05:00.000Z',
		content_hash: 'hash-1',
		raw_metadata: {},
		taxonomy: null,
		source_name: 'Demo Wire',
		source_is_demo: true,
		...overrides
	};
}

export const SUMMARY_INPUT: SummaryInput = {
	articles: [
		{
			ref: 'a1',
			source_name: 'Demo Wire',
			title: 'Fictional port authority reopens harbour after storm',
			excerpt: 'The fictional harbour of Port Vela reopened on Tuesday, officials said.',
			published_at: '2026-11-13T01:00:00.000Z',
			language: 'en'
		},
		{
			ref: 'a2',
			source_name: 'Sample Times',
			title: 'Port Vela shipping resumes',
			excerpt: null,
			published_at: null,
			language: 'en'
		}
	],
	extraction: {
		facts: [{ text: 'Port Vela harbour reopened.', evidence: ['a1', 'a2'] }],
		claims: [{ claimant: 'Port authority', claim: 'Damage was minor.', evidence: ['a1'] }],
		occurred_at: null,
		countries: [],
		sensitive: false,
		open_questions: []
	},
	previous: null
};

export const VALID_EXTRACTION: ExtractionOutput = SUMMARY_INPUT.extraction;

export const VALID_SUMMARY: SummaryOutput = {
	title_th: 'ท่าเรือพอร์ตเวลากลับมาเปิดหลังพายุ',
	summary_th: 'ท่าเรือสมมุติพอร์ตเวลากลับมาเปิดให้บริการแล้วหลังพายุผ่านพ้น',
	what_happened_th: 'ท่าเรือพอร์ตเวลากลับมาเปิดให้บริการ',
	why_it_matters_th: 'การขนส่งสินค้าในภูมิภาคอาจกลับมาเป็นปกติ',
	background_th: null,
	uncertain_th: 'ไม่แน่ชัด',
	claims_th: [{ claimant_th: 'การท่าเรือ', claim_th: 'ความเสียหายมีเพียงเล็กน้อย', evidence: ['a1'] }],
	impact_breadth: 1,
	thailand_relevance: 0,
	cited_refs: ['a1', 'a2'],
	update_th: null,
	update_refs: [],
	credibility_level: 'none',
	credibility_reason_th: null
};

export const REF_TO_ARTICLE_ID: Record<string, string> = { a1: 'art-1', a2: 'art-2' };

const EVENT_REF = {
	ref: 'e1',
	title_th: 'ท่าเรือพอร์ตเวลากลับมาเปิด',
	summary_th: 'ท่าเรือสมมุติกลับมาเปิดหลังพายุ',
	event_date: '2026-11-13',
	category: 'economy' as const,
	tags: ['ports'],
	articles: [SUMMARY_INPUT.articles[0]!]
};

/** One valid input per task (refs a1/a2, e1/e2, p1, lesson w1-d01). */
export const INPUT_BY_TASK: { [T in LlmTask]: LlmInput<T> } = {
	tagging: { articles: SUMMARY_INPUT.articles },
	clustering: {
		pairs: [
			{
				pair_ref: 'p1',
				a: { title: 'Port Vela reopens', summary: null, published_at: null, tags: ['ports'] },
				b: { title: 'Storm hits Port Vela', summary: null, published_at: null, tags: ['storms'] }
			}
		]
	},
	extraction: { articles: SUMMARY_INPUT.articles },
	summary: SUMMARY_INPUT,
	relations: {
		event: EVENT_REF,
		candidates: [
			{ ...EVENT_REF, ref: 'e2', articles: [{ ...SUMMARY_INPUT.articles[1]!, ref: 'a2' }] }
		]
	},
	academy_linking: {
		event: {
			ref: 'e1',
			title_th: EVENT_REF.title_th,
			summary_th: EVENT_REF.summary_th,
			category: 'economy',
			tags: ['ports']
		},
		lessons: [
			{
				lesson_id: 'w1-d01',
				title: 'ภาพรวมสงครามโลก',
				summary: 'บทนำ',
				related_tags: ['world-wars'],
				related_categories: ['geopolitics']
			}
		]
	}
};

export const LINKED_ARTICLES: ArticleWithSource[] = [
	makeArticle(),
	makeArticle({
		id: 'art-2',
		source_id: 'sample-times',
		canonical_url: 'https://sample.example.com/b/2',
		source_url: 'https://sample.example.com/b/2',
		publisher_name: 'Sample Times',
		source_name: 'Sample Times'
	})
];
