import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client';
import { dailyBriefEvents, dailyBriefs } from '../schema';
import { seedDatabase } from '../seed';
import { openTestDb } from '../test-db';
import { createRepositories } from './index';

let db: Db;
let repos: ReturnType<typeof createRepositories>;

beforeEach(async () => {
	db = openTestDb();
	repos = createRepositories(db);
	await repos.ingest.syncSources([
		{
			id: 'wire-a',
			name: 'Wire A',
			kind: 'fixture',
			homepage_url: 'https://example.com/a',
			feed_url: 'a.xml',
			license_notes: '',
			allow_excerpt: false,
			is_demo: false,
			enabled: true
		}
	]);
});
afterEach(() => db.$client.close());

async function publishedEventAt(publishedAt: string, slug: string): Promise<string> {
	const { article_id } = await repos.ingest.insertArticleIfNew({
		source_id: 'wire-a',
		source_url: `https://example.com/a/${slug}`,
		canonical_url: `https://example.com/a/${slug}`,
		publisher_name: 'Wire A',
		title: slug,
		excerpt: null,
		language: 'en',
		published_at: publishedAt,
		ingested_at: publishedAt,
		content_hash: slug,
		raw_metadata: {}
	});
	const id = await repos.digest.createDraftEvent([article_id], 1, publishedAt);
	await repos.digest.saveEventContent(
		id,
		{
			title_th: 'ข่าว',
			summary_th: 'สรุป',
			what_happened_th: 'เกิดขึ้น',
			why_it_matters_th: 'สำคัญ',
			background_th: null,
			uncertain_th: null,
			claims: [],
			category: 'economy',
			regions: ['asia'],
			countries: [],
			tags: [],
			signals: { impact_breadth: 1, thailand_relevance: 1, sensitive: false },
			occurred_at: null,
			summarized_at: publishedAt,
			status: 'published',
			review_reasons: [],
			new_updates: [],
			listed: { updated_at: publishedAt, status: 'draft' }
		},
		publishedAt
	);
	return id;
}

describe('BriefRepository', () => {
	// morning 2026-11-13 window = [2026-11-12 07:00 ICT, 2026-11-13 07:00 ICT) = [00:00Z, 00:00Z)
	const window = { start_utc: '2026-11-12T00:00:00.000Z', end_utc: '2026-11-13T00:00:00.000Z' };

	it('selects published events with evidence in [start, end)', async () => {
		const atStart = await publishedEventAt('2026-11-12T00:00:00.000Z', 'start');
		await publishedEventAt('2026-11-13T00:00:00.000Z', 'end');
		await publishedEventAt('2026-11-11T23:59:59.999Z', 'before');

		const candidates = await repos.briefs.listCandidateEvents(window);

		expect(candidates.map((candidate) => candidate.id)).toEqual([atStart]);
		expect(candidates[0]).toMatchObject({ is_continuing: false, signals: { impact_breadth: 1 } });
	});

	it('flags continuing stories (an update or a published relation to an older event)', async () => {
		seedDatabase(db, []);
		// morning 2026-11-12 window: [2026-11-11 07:00 ICT, 2026-11-12 07:00 ICT)
		const candidates = await repos.briefs.listCandidateEvents({
			start_utc: '2026-11-11T00:00:00.000Z',
			end_utc: '2026-11-12T00:00:00.000Z'
		});
		const continuing = Object.fromEntries(candidates.map((c) => [c.id, c.is_continuing]));
		// demo-evt-10 has an update; demo-evt-11 has neither an update nor a public relation.
		expect(continuing).toEqual({ 'demo-evt-10': true, 'demo-evt-11': false });
	});

	it('upserts a brief by (brief_date, edition) and replaces its items', async () => {
		const a = await publishedEventAt('2026-11-12T01:00:00.000Z', 'a');
		const b = await publishedEventAt('2026-11-12T02:00:00.000Z', 'b');
		const input = {
			brief_date: '2026-11-13',
			edition: 'morning' as const,
			status: 'published' as const,
			generated_at: '2026-11-13T00:00:00.000Z',
			items: [
				{ event_id: a, rank: 1, selection_reason: 'สำคัญ' },
				{ event_id: b, rank: 2, selection_reason: 'เกี่ยวข้อง' }
			]
		};

		const firstId = await repos.briefs.saveBrief(input);
		const secondId = await repos.briefs.saveBrief({
			...input,
			generated_at: '2026-11-13T00:30:00.000Z',
			items: [{ event_id: b, rank: 1, selection_reason: 'สำคัญที่สุด' }]
		});

		expect(secondId).toBe(firstId);
		expect(db.select().from(dailyBriefs).all()).toEqual([
			expect.objectContaining({
				published_at: '2026-11-13T00:00:00.000Z',
				generated_at: '2026-11-13T00:30:00.000Z',
				event_count: 1
			})
		]);
		expect(db.select().from(dailyBriefEvents).all()).toHaveLength(1);

		const view = await repos.read.getPublishedBrief('2026-11-13');
		expect(view?.events.map((event) => [event.id, event.rank])).toEqual([[b, 1]]);
	});

	it('stores an empty brief as draft, which is not public', async () => {
		await repos.briefs.saveBrief({
			brief_date: '2026-11-13',
			edition: 'evening',
			status: 'draft',
			generated_at: '2026-11-13T12:00:00.000Z',
			items: []
		});
		expect(await repos.read.getPublishedBrief('2026-11-13', 'evening')).toBeNull();
		expect(await repos.read.getLatestPublishedBriefDate()).toBeNull();
	});
});
