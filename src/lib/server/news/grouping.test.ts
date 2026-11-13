import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EventMatchCandidate } from '#lib/types/news.js';
import {
	bestEventMatch,
	eventTypesOf,
	GROUPING_CONFIG,
	planGrouping,
	titleEntities,
	titleTokens,
	type GroupableArticle
} from './grouping';

interface GroupingCase {
	name: string;
	titles: string[];
}
const CASES = JSON.parse(
	readFileSync(new URL('../../../../tests/fixtures/grouping/cases.json', import.meta.url), 'utf8')
) as { mustNotMerge: GroupingCase[]; mustMerge: GroupingCase[] };

const article = (id: string, title: string, publishedAt: string): GroupableArticle => ({
	id,
	title,
	published_at: publishedAt,
	ingested_at: '2026-11-13T00:00:00.000Z'
});

/** Titles one hour apart, in order. */
const articlesOf = (titles: string[]) =>
	titles.map((title, index) =>
		article(`a${index}`, title, new Date(Date.UTC(2026, 10, 13, index)).toISOString())
	);

const event = (overrides: Partial<EventMatchCandidate>): EventMatchCandidate => ({
	event_id: 'event-1',
	title: '',
	tags: [],
	first_seen_at: '2026-11-12T10:00:00.000Z',
	last_updated_at: '2026-11-12T12:00:00.000Z',
	article_titles: [],
	is_demo: false,
	...overrides
});

describe('planGrouping regression cases (tests/fixtures/grouping/cases.json)', () => {
	it.each(CASES.mustNotMerge.map((entry) => [entry.name, entry.titles] as const))(
		'does NOT merge: %s',
		(_name, titles) => {
			const plan = planGrouping(articlesOf([...titles]), []);
			expect(plan.new_events).toHaveLength(titles.length);
			expect(plan.joins).toEqual([]);
		}
	);

	it.each(CASES.mustMerge.map((entry) => [entry.name, entry.titles] as const))(
		'merges: %s',
		(_name, titles) => {
			const plan = planGrouping(articlesOf([...titles]), []);
			expect(plan.new_events).toHaveLength(1);
			expect(plan.new_events[0]!.article_ids).toHaveLength(titles.length);
		}
	);

	it('does not merge into an existing event with a conflicting place', () => {
		const plan = planGrouping(
			[article('n1', 'Magnitude 6.1 earthquake strikes off Chile coast', '2026-11-12T13:00:00Z')],
			[event({ article_titles: ['Magnitude 6.1 earthquake strikes off Japan coast'] })]
		);
		expect(plan.joins).toEqual([]);
		expect(plan.ambiguous_count).toBe(1);
	});
});

describe('planGrouping', () => {
	it('acceptance #3: three sources on the same story form one event; an unrelated story stays separate', () => {
		const plan = planGrouping(
			[
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
					'c1',
					'Avalor and Meridia agree water-sharing deal for Kessel River',
					'2026-11-12T19:45:00Z'
				),
				article(
					'a2',
					'Northland central bank holds policy rate at 3.5 percent',
					'2026-11-12T11:00:00Z'
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

	it('attaches an article to an existing recent event, comparing with its article titles', () => {
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
					// A Thai summary title is not compared with English reports.
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

	it('keeps an unrelated Thai story apart from a Thai story pair', () => {
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

	it('bestEventMatch recomputes the ambiguous score of a draft against existing events', () => {
		const accord = event({
			event_id: 'kessel',
			article_titles: ['Avalor and Meridia sign Kessel River water-sharing accord'],
			first_seen_at: '2026-11-12T10:00:00Z',
			last_updated_at: '2026-11-12T10:00:00Z'
		});
		const farAway = event({
			event_id: 'old',
			article_titles: ['Avalor and Meridia sign trade accord'],
			first_seen_at: '2026-10-01T10:00:00Z',
			last_updated_at: '2026-10-01T10:00:00Z'
		});
		const draft = [article('x2', 'Avalor and Meridia sign trade accord', '2026-11-12T11:00:00Z')];

		const match = bestEventMatch(draft, [accord, farAway]);
		expect(match?.event_id).toBe('kessel');
		expect(match!.score).toBeGreaterThanOrEqual(GROUPING_CONFIG.ambiguousThreshold);
		expect(match!.score).toBeLessThan(GROUPING_CONFIG.joinThreshold);
		expect(bestEventMatch(draft, [farAway])).toBeNull();
	});

	it('is deterministic regardless of input order', () => {
		const inputs = articlesOf([
			'Avalor and Meridia sign Kessel River water-sharing accord',
			'Kessel River water-sharing accord signed by Avalor and Meridia',
			'Northland central bank holds policy rate at 3.5 percent'
		]);
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

	it('drops number-only tokens', () => {
		expect(titleTokens('Magnitude 6.1 quake, 2.5% rate, ๒๕๖๙')).toEqual(
			new Set(['magnitude', 'quake', 'rate'])
		);
	});

	it('turns Thai runs into character trigrams, keeping vowel and tone marks', () => {
		expect(titleTokens('ข่าวดี')).toEqual(new Set(['ข่า', '่าว', 'าวด', 'วดี']));
	});
});

describe('titleEntities / eventTypesOf', () => {
	it.each([
		['places, including a first word', 'Thailand central bank holds rate', ['thailand']],
		['places in Title Case', 'Magnitude 6.1 Earthquake Strikes Off Japan Coast', ['japan']],
		[
			'acronyms and proper nouns',
			'UN Security Council votes on Gaza resolution',
			['gaza', 'un', 'security', 'council']
		],
		[
			'proper nouns after the first word',
			'Avalor and Meridia sign Kessel River accord',
			['meridia', 'kessel', 'river']
		],
		['Thai provinces', 'นายกรัฐมนตรีลงพื้นที่ตรวจน้ำท่วมเชียงใหม่', ['chiang mai']],
		['nothing generic', 'Magnitude quake strikes coast', []]
	])('entities: %s', (_name, title, expected) => {
		expect([...titleEntities(title)].sort()).toEqual([...expected].sort());
	});

	it('finds event types in English (whole words) and Thai (substrings)', () => {
		expect([...eventTypesOf('Bangkok floods: death toll rises')]).toEqual(['flood']);
		expect([...eventTypesOf('Bangkok death toll from heatwave rises')]).toEqual(['heatwave']);
		expect([...eventTypesOf('นายกฯ ตรวจไฟป่าเชียงราย')]).toEqual(['wildfire']);
		expect([...eventTypesOf('Earthquake strikes')]).toEqual(['earthquake']);
		expect([...eventTypesOf('Market crash fears grow')]).toEqual([]);
	});
});
