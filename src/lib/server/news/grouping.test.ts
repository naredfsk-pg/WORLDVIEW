import { describe, expect, it } from 'vitest';
import type { EventMatchCandidate } from '#lib/types/news.js';
import { GROUPING_CONFIG, planGrouping, titleTokens, type GroupableArticle } from './grouping';

const article = (
	id: string,
	title: string,
	publishedAt: string,
	categories: string[] = []
): GroupableArticle => ({
	id,
	title,
	published_at: publishedAt,
	ingested_at: '2026-11-13T00:00:00.000Z',
	categories
});

const event = (overrides: Partial<EventMatchCandidate>): EventMatchCandidate => ({
	event_id: 'event-1',
	title: '',
	tags: [],
	first_seen_at: '2026-11-12T10:00:00.000Z',
	last_updated_at: '2026-11-12T12:00:00.000Z',
	article_titles: [],
	...overrides
});

describe('planGrouping', () => {
	it('acceptance #3: three sources on the same story form one event; an unrelated story stays separate', () => {
		const plan = planGrouping(
			[
				article(
					'a1',
					'Avalor and Meridia sign Kessel River water-sharing accord',
					'2026-11-12T16:30:00Z',
					['Avalor', 'Water']
				),
				article(
					'b1',
					'Kessel River water-sharing accord signed by Avalor and Meridia',
					'2026-11-12T17:05:00Z',
					['Water']
				),
				article(
					'c1',
					'Avalor and Meridia agree water-sharing deal for Kessel River',
					'2026-11-12T19:45:00Z',
					['Meridia']
				),
				article(
					'a2',
					'Northland central bank holds policy rate at 3.5 percent',
					'2026-11-12T11:00:00Z',
					['Economy']
				)
			],
			[]
		);

		expect(plan.joins).toEqual([]);
		expect(plan.new_events.map((group) => [...group.article_ids].sort())).toEqual(
			expect.arrayContaining([['a1', 'b1', 'c1'], ['a2']])
		);
		expect(plan.new_events).toHaveLength(2);
		const story = plan.new_events.find((group) => group.article_ids.includes('a1'))!;
		expect(story.confidence).toBeGreaterThanOrEqual(GROUPING_CONFIG.joinThreshold);
		expect(story.confidence).toBeLessThanOrEqual(1);
	});

	it('attaches an article to an existing recent event that matches', () => {
		const plan = planGrouping(
			[
				article(
					'n1',
					'Kessel River accord: Avalor and Meridia sign water-sharing deal',
					'2026-11-13T02:00:00Z'
				)
			],
			[
				event({
					event_id: 'kessel',
					title: 'ข้อตกลงแบ่งปันน้ำแม่น้ำเคสเซล',
					article_titles: ['Avalor and Meridia sign Kessel River water-sharing accord'],
					first_seen_at: '2026-11-12T16:30:00.000Z',
					last_updated_at: '2026-11-12T19:45:00.000Z'
				}),
				event({ event_id: 'other', article_titles: ['Port Selene opens container terminal'] })
			]
		);
		expect(plan.new_events).toEqual([]);
		expect(plan.joins).toEqual([
			{ event_id: 'kessel', article_ids: ['n1'], confidence: expect.any(Number) }
		]);
	});

	it('does not join an event outside the time window', () => {
		const plan = planGrouping(
			[
				article(
					'late',
					'Avalor and Meridia sign Kessel River water-sharing accord',
					'2026-11-20T00:00:00Z'
				)
			],
			[
				event({
					event_id: 'kessel',
					article_titles: ['Avalor and Meridia sign Kessel River water-sharing accord'],
					first_seen_at: '2026-11-12T16:30:00.000Z',
					last_updated_at: '2026-11-12T19:45:00.000Z'
				})
			]
		);
		expect(plan.joins).toEqual([]);
		expect(plan.new_events).toEqual([{ article_ids: ['late'], confidence: 1 }]);
	});

	it('groups Thai titles about the same story (character trigrams) and keeps another Thai story apart', () => {
		const plan = planGrouping(
			[
				article('t1', 'ธนาคารกลางนอร์ทแลนด์คงอัตราดอกเบี้ยนโยบายที่ 3.5%', '2026-11-12T10:00:00Z'),
				article('t2', 'ธนาคารกลางนอร์ทแลนด์ คงอัตราดอกเบี้ยนโยบาย 3.5%', '2026-11-12T11:00:00Z'),
				article('t3', 'เทศกาลโคมไฟแห่งเมืองเวลลาเปิดฉากอย่างยิ่งใหญ่', '2026-11-12T12:00:00Z')
			],
			[]
		);
		expect(plan.new_events.map((group) => group.article_ids)).toEqual([['t1', 't2'], ['t3']]);
	});

	it('counts an ambiguous score as a new event (no LLM clustering yet: wrong merges are worse than duplicates)', () => {
		const plan = planGrouping(
			[
				article(
					'x1',
					'Avalor and Meridia sign Kessel River water-sharing accord',
					'2026-11-12T10:00:00Z'
				),
				// Shares most words with x1 but is a different accord: the rules cannot tell, an LLM could.
				article('x2', 'Avalor and Meridia sign trade accord', '2026-11-12T11:00:00Z')
			],
			[]
		);
		expect(plan.new_events).toHaveLength(2);
		expect(plan.ambiguous_count).toBe(1);
	});

	it('is deterministic regardless of input order', () => {
		const inputs = [
			article(
				'a1',
				'Avalor and Meridia sign Kessel River water-sharing accord',
				'2026-11-12T16:30:00Z'
			),
			article(
				'b1',
				'Kessel River water-sharing accord signed by Avalor and Meridia',
				'2026-11-12T17:05:00Z'
			),
			article(
				'a2',
				'Northland central bank holds policy rate at 3.5 percent',
				'2026-11-12T11:00:00Z'
			)
		];
		expect(planGrouping([...inputs].reverse(), [])).toEqual(planGrouping(inputs, []));
	});
});

describe('titleTokens', () => {
	it('drops English stopwords and stems light inflections', () => {
		expect(titleTokens('The council approves the plans')).toEqual(
			new Set(['council', 'approv', 'plan'])
		);
		expect(titleTokens('Council approved plan')).toEqual(new Set(['council', 'approv', 'plan']));
	});

	it('turns Thai runs into character trigrams, keeping vowel and tone marks', () => {
		expect(titleTokens('ข่าวดี')).toEqual(new Set(['ข่า', '่าว', 'าวด', 'วดี']));
	});
});
