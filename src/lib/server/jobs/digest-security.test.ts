/**
 * Security review regressions for the digest (2026-11-13 full-system review, probes in
 * `scratchpad/probe-system`): the auto-publish policy (#1), the admin flag lost to a concurrent
 * digest (#4, probe `race.mts`), LLM fairness and budget (#6) and relations (#8). Fixture feeds,
 * an in-memory database and the mock LLM; no network.
 */
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { articles, eventRelations, events } from '#lib/server/db/schema.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import type { AutoPublishPolicy } from '#lib/types/editorial.js';
import type { LlmTask, MockLlmHandlers } from '#lib/types/llm.js';
import type { Repositories } from '#lib/types/repositories.js';
import { createDefaultMockHandlers, createMockLlmProvider, mockLlmError } from '../llm/mock';
import { SINGLE_SOURCE_FLOOR_REASON_TH } from '../editorial/index';
import { createFixtureAdapter } from '../news/adapters';
import { sourceRegistryFor } from '../news/sources';
import { runDigest } from './digest';
import { runIngest } from './ingest';
import { hourlyJobSlot } from './job-slots';
import { createJsonLogger } from './logger';
import { runJob } from './runner';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NOW = new Date('2026-11-13T00:00:00.000Z');
const EDITOR = { changed_by: 'editor@example.com', change_reason: 'hold for check' };

let db: Db;
let repositories: Repositories;
let clock: Date;
let articleCounter = 0;

beforeEach(async () => {
	db = openTestDb();
	repositories = createRepositories(db);
	clock = NOW;
	await repositories.academy.replaceLessonCatalog([]);
});
afterEach(() => db.$client.close());

const logger = () =>
	createJsonLogger(
		() => {},
		() => clock
	);

const allEvents = () => db.select().from(events).all();
const eventById = (id: string) => db.select().from(events).where(eq(events.id, id)).get()!;

async function ingestFixtures() {
	const result = await runJob(
		{ jobs: repositories.jobs, logger: logger(), now: () => clock },
		{
			job_type: 'ingest',
			...hourlyJobSlot('ingest', clock, 'fixtures'),
			trigger: 'cron',
			force: true
		},
		(ctx) =>
			runIngest(
				{
					ingest: repositories.ingest,
					digest: repositories.digest,
					registry: sourceRegistryFor('fixtures'),
					adapters: { fixture: createFixtureAdapter(REPO_ROOT) },
					safeFetch: async () => {
						throw new Error('no network in tests');
					},
					maxItemAgeHours: null
				},
				ctx
			)
	);
	if (result.status === 'skipped') throw new Error('ingest was skipped');
}

async function digest(
	autoPublish: AutoPublishPolicy,
	mock: MockLlmHandlers = createDefaultMockHandlers()
) {
	const result = await runJob(
		{ jobs: repositories.jobs, logger: logger(), now: () => clock },
		{ job_type: 'digest', ...hourlyJobSlot('digest', clock), trigger: 'manual', force: true },
		(ctx) =>
			runDigest(
				{
					digest: repositories.digest,
					llm: createMockLlmProvider(mock),
					llmCalls: repositories.llmCalls,
					autoPublish,
					relationMinConfidence: 0.8
				},
				ctx
			)
	);
	if (result.status === 'skipped') throw new Error('digest was skipped');
	return result;
}

/** Handlers that count the calls per task. */
function countingHandlers(counts: Partial<Record<LlmTask, number>>): MockLlmHandlers {
	const defaults = createDefaultMockHandlers();
	const counted = <T extends LlmTask>(task: T) =>
		((input: never) => {
			counts[task] = (counts[task] ?? 0) + 1;
			return (defaults[task] as (input: never) => unknown)(input);
		}) as unknown as MockLlmHandlers[T];
	return {
		...defaults,
		extraction: counted('extraction'),
		summary: counted('summary')
	};
}

async function addArticle(sourceId: string, title: string): Promise<string> {
	const n = ++articleCounter;
	const result = await repositories.ingest.insertArticleIfNew({
		source_id: sourceId,
		source_url: `https://fixtures.worldview.invalid/security/${n}`,
		canonical_url: `https://fixtures.worldview.invalid/security/${n}`,
		publisher_name: sourceId,
		title,
		excerpt: null,
		language: 'en',
		published_at: clock.toISOString(),
		ingested_at: clock.toISOString(),
		content_hash: `security-${n}`,
		raw_metadata: {}
	});
	return result.article_id;
}

describe('#1 auto-publish policy (EDITORIAL_AUTO_PUBLISH)', () => {
	it('off: every event that passes the gates waits for an admin, with its text stored', async () => {
		await ingestFixtures();
		const result = await digest('off');

		expect(result.counters).toMatchObject({ events_published: 0, events_pending_review: 4 });
		for (const row of allEvents()) {
			expect(row).toMatchObject({
				status: 'pending_review',
				review_reasons: ['auto_publish_disabled']
			});
			expect(row.title_th).toMatch(/\p{Script=Thai}/u);
		}
		const queue = await repositories.admin.listReviewQueue();
		expect(queue.events).toHaveLength(4);
	});

	it('multi_source: only the event with two or more registry sources is published', async () => {
		await ingestFixtures();
		await digest('multi_source');

		const published = allEvents().filter((row) => row.status === 'published');
		expect(published.map((row) => row.source_count)).toEqual([3]);
		for (const row of allEvents().filter((row) => row.status !== 'published')) {
			expect(row).toMatchObject({
				status: 'pending_review',
				review_reasons: ['auto_publish_disabled']
			});
			expect(row.source_count).toBe(1);
		}
	});

	it('admin publish (G1–G3) still works in off mode', async () => {
		await ingestFixtures();
		await digest('off');
		const id = allEvents()[0]!.id;
		const { adminPublishGate } = await import('../../../routes/admin/admin-forms.server');
		const result = await repositories.admin.publishEvent(
			id,
			adminPublishGate,
			{ ...EDITOR, public_note_th: null },
			NOW.toISOString(),
			(tags) => tags
		);
		expect(result).toEqual({ ok: true });
		expect(eventById(id)).toMatchObject({ status: 'published', review_reasons: [] });
	});

	for (const policy of ['off', 'multi_source'] as const) {
		it(`${policy}: new evidence never rewrites a published event; it is flagged for an admin`, async () => {
			await ingestFixtures();
			await digest('all');
			const target = allEvents().find((row) => row.source_count === 3)!;
			const before = eventById(target.id);

			clock = new Date(NOW.getTime() + 60 * 60 * 1000);
			const joined = await addArticle('fixture-wire-b', 'Kessel accord follow-up');
			await repositories.digest.linkArticles(target.id, [joined], 1, clock.toISOString());
			const counts: Partial<Record<LlmTask, number>> = {};
			const result = await digest(policy, countingHandlers(counts));

			expect(result.counters.events_new_evidence).toBe(1);
			expect(counts).toEqual({}); // no extraction or summary call at all
			const after = eventById(target.id);
			expect(after).toMatchObject({
				status: 'published',
				title_th: before.title_th,
				summary_th: before.summary_th,
				what_happened_th: before.what_happened_th,
				review_reasons: ['new_evidence_pending']
			});
			// The new article is linked and shown as a source.
			const detail = await repositories.read.getPublishedEventDetail(target.id);
			expect(detail?.sources.map((source) => source.article_id)).toContain(joined);
			// The admin review queue lists it, and "confirm" clears the flag and keeps it public.
			const queue = await repositories.admin.listReviewQueue();
			expect(queue.events.map((row) => row.id)).toContain(target.id);
			expect((await repositories.admin.countReviewQueue()).events).toBe(1);
			const { adminPublishGate } = await import('../../../routes/admin/admin-forms.server');
			expect(
				await repositories.admin.publishEvent(
					target.id,
					adminPublishGate,
					{ ...EDITOR, public_note_th: null },
					clock.toISOString(),
					(tags) => tags
				)
			).toEqual({ ok: true });
			expect(eventById(target.id)).toMatchObject({ status: 'published', review_reasons: [] });

			// Nothing new since: the next run leaves it alone.
			clock = new Date(clock.getTime() + 60 * 60 * 1000);
			const again = await digest(policy, countingHandlers(counts));
			expect(again.counters.events_new_evidence).toBe(0);
			expect(eventById(target.id).review_reasons).toEqual([]);
		});
	}

	it('all: a published event is still re-summarized (current behaviour)', async () => {
		await ingestFixtures();
		await digest('all');
		const target = allEvents().find((row) => row.source_count === 3)!;
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const joined = await addArticle('fixture-wire-b', 'Kessel accord follow-up');
		await repositories.digest.linkArticles(target.id, [joined], 1, clock.toISOString());
		const counts: Partial<Record<LlmTask, number>> = {};
		await digest('all', countingHandlers(counts));

		expect(counts.summary).toBe(1);
		expect(eventById(target.id)).toMatchObject({ status: 'published', review_reasons: [] });
	});
});

describe('credibility label (auto-publish wave)', () => {
	/** Every extraction says sensitive; the summary proposes `level` with `reason`. */
	function labelled(level: 'none' | 'disputed', reason: string | null): MockLlmHandlers {
		const defaults = createDefaultMockHandlers();
		return {
			...defaults,
			extraction: (input) =>
				({ ...(defaults.extraction!(input) as object), sensitive: true }) as never,
			summary: (input) =>
				({
					...(defaults.summary!(input) as object),
					credibility_level: level,
					credibility_reason_th: reason
				}) as never
		};
	}

	it('all: a sensitive single-source event is published with the unverified floor', async () => {
		await ingestFixtures();
		await digest('all', labelled('none', null));

		const rows = allEvents();
		expect(rows.every((row) => row.status === 'published')).toBe(true);
		for (const row of rows) {
			expect(row.review_reasons).toEqual([]);
			expect(row.credibility_level).toBe(row.source_count >= 2 ? 'none' : 'unverified');
			expect(row.credibility_reason_th).toBe(
				row.source_count >= 2 ? null : SINGLE_SOURCE_FLOOR_REASON_TH
			);
		}
		// Public DTOs carry the label.
		const single = rows.find((row) => row.source_count === 1)!;
		const detail = await repositories.read.getPublishedEventDetail(single.id);
		expect(detail).toMatchObject({ credibility_level: 'unverified' });
	});

	for (const policy of ['off', 'multi_source'] as const) {
		it(`${policy}: a sensitive single-source event still waits (G6)`, async () => {
			await ingestFixtures();
			await digest(policy, labelled('none', null));
			for (const row of allEvents().filter((row) => row.source_count === 1)) {
				expect(row).toMatchObject({
					status: 'pending_review',
					review_reasons: ['sensitive_single_source']
				});
			}
		});
	}

	it('stores the model label and drops a reason that fails G3, never blocking the publish', async () => {
		await ingestFixtures();
		await digest('all', labelled('disputed', 'ดูหลักฐานที่ evil.example.com'));

		for (const row of allEvents()) {
			expect(row).toMatchObject({
				status: 'published',
				credibility_level: 'disputed',
				credibility_reason_th: null
			});
		}
	});

	it('a re-summary recomputes the label, but keeps an admin override', async () => {
		await ingestFixtures();
		await digest('all', labelled('none', null));
		const [multi, single] = [
			allEvents().find((row) => row.source_count === 3)!,
			allEvents().find((row) => row.source_count === 1)!
		];
		await repositories.admin.updateEventIfCurrent(
			single.id,
			single.updated_at,
			{ credibility_level: 'none', credibility_reason_th: null },
			{ ...EDITOR, public_note_th: null },
			clock.toISOString()
		);

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		for (const id of [multi.id, single.id]) {
			const joined = await addArticle('fixture-wire-c', `Follow-up ${id}`);
			await repositories.digest.linkArticles(id, [joined], 1, clock.toISOString());
		}
		const reason = 'รายงานจากแต่ละแหล่งระบุตัวเลขไม่ตรงกัน';
		await digest('all', labelled('disputed', reason));

		expect(eventById(multi.id)).toMatchObject({
			credibility_level: 'disputed',
			credibility_reason_th: reason
		});
		expect(eventById(single.id)).toMatchObject({
			credibility_level: 'none',
			credibility_reason_th: null
		});

		// "อัตโนมัติ": the release hands the label back; the next re-summary sets it again.
		await repositories.admin.updateEventIfCurrent(
			single.id,
			eventById(single.id).updated_at,
			{},
			{ ...EDITOR, public_note_th: null },
			clock.toISOString(),
			{ releaseCredibility: true }
		);
		clock = new Date(clock.getTime() + 60 * 60 * 1000);
		const later = await addArticle('fixture-wire-c', `Second follow-up ${single.id}`);
		await repositories.digest.linkArticles(single.id, [later], 1, clock.toISOString());
		await digest('all', labelled('disputed', reason));
		expect(eventById(single.id)).toMatchObject({
			credibility_level: 'disputed',
			credibility_reason_th: reason
		});
	});

	it('the floor also counts the stored sensitive signal (as G6 does)', async () => {
		await ingestFixtures();
		await digest('all', labelled('none', null));
		const single = allEvents().find((row) => row.source_count === 1)!;
		expect(single.signals?.sensitive).toBe(true);

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const detail = await repositories.read.getPublishedEventDetail(single.id);
		const { source_id } = db
			.select({ source_id: articles.source_id })
			.from(articles)
			.where(eq(articles.id, detail!.sources[0]!.article_id))
			.get()!;
		const joined = await addArticle(source_id, 'Same outlet follow-up');
		await repositories.digest.linkArticles(single.id, [joined], 1, clock.toISOString());
		// The fresh extraction no longer says sensitive; the stored signal still does.
		const defaults = createDefaultMockHandlers();
		await digest('all', defaults);

		expect(eventById(single.id)).toMatchObject({
			source_count: 1,
			credibility_level: 'unverified',
			credibility_reason_th: SINGLE_SOURCE_FLOOR_REASON_TH
		});
	});
});

describe('#4 admin flag during the summary call (probe race.mts)', () => {
	it('keeps the flag, and the flagged events stay unpublished', async () => {
		await ingestFixtures();
		const defaults = createDefaultMockHandlers();
		const flagged: string[] = [];
		const result = await digest('all', {
			...defaults,
			summary: (input) => {
				// The admin flags every draft while the LLM is working (the probe's scenario).
				if (flagged.length === 0) {
					for (const row of allEvents().filter((event) => event.status === 'draft')) {
						repositories.admin.flagEvent(
							row.id,
							{ ...EDITOR, public_note_th: null },
							NOW.toISOString()
						);
						flagged.push(row.id);
					}
				}
				return defaults.summary(input);
			}
		});

		expect(flagged).toHaveLength(4);
		expect(result.counters.events_published).toBe(0);
		expect(result.counters.events_skipped).toBe(4);
		for (const id of flagged) {
			expect(eventById(id)).toMatchObject({
				status: 'pending_review',
				review_reasons: ['manual_flag'],
				title_th: ''
			});
		}
	});

	it('an LLM failure does not overwrite a flag set meanwhile', async () => {
		await ingestFixtures();
		const defaults = createDefaultMockHandlers();
		let flaggedId: string | null = null;
		await digest('all', {
			...defaults,
			extraction: () => {
				if (flaggedId === null) {
					flaggedId = allEvents()[0]!.id;
					repositories.admin.flagEvent(
						flaggedId,
						{ ...EDITOR, public_note_th: null },
						NOW.toISOString()
					);
				}
				return mockLlmError('timeout');
			}
		});

		expect(eventById(flaggedId!)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['manual_flag']
		});
	});
});

describe('#6 LLM fairness and budget', () => {
	it('takes events round-robin by source, so one busy feed cannot fill every slot', async () => {
		await repositories.ingest.syncSources([...sourceRegistryFor('fixtures')]);
		const busy: string[] = [];
		for (let index = 0; index < 5; index++) {
			clock = new Date(NOW.getTime() + index * 60 * 1000);
			const article = await addArticle('fixture-wire-a', `Busy feed story ${index}`);
			busy.push(await repositories.digest.createDraftEvent([article], 1, clock.toISOString()));
		}
		// The quiet feed's story is the oldest, so newest-first alone would never reach it.
		clock = new Date(NOW.getTime() - 60 * 60 * 1000);
		const quietArticle = await addArticle('fixture-wire-c', 'Quiet feed story');
		const quiet = await repositories.digest.createDraftEvent(
			[quietArticle],
			1,
			clock.toISOString()
		);

		const listed = await repositories.digest.listEventsNeedingContent(2, NOW.toISOString());
		expect(listed.map((item) => item.event.id)).toEqual([busy[4], quiet]);
	});

	it('stops at the LLM budget and leaves the remaining events untouched (not failed)', async () => {
		await ingestFixtures();
		const result = await digest('all', {
			...createDefaultMockHandlers(),
			extraction: () => mockLlmError('budget_exceeded')
		});

		expect(result.status).toBe('partial');
		expect(result.counters).toMatchObject({ events_published: 0, events_pending_review: 0 });
		expect(allEvents().every((row) => row.status === 'draft')).toBe(true);
		const run = (await repositories.jobs.listRecent(1))[0]!;
		expect(run.error).toContain('LLM budget used up');
	});
});

describe('#8 relations', () => {
	async function relateNewEventWith(confidence: number) {
		await ingestFixtures();
		await digest('all');
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		await ingestFixtures();
		const defaults = createDefaultMockHandlers();
		const draft = allEvents().find((row) => row.status === 'published')!;
		// A new event related to the published ones.
		const article = await addArticle('fixture-wire-c', 'Kessel River talks: what comes next');
		await repositories.digest.createDraftEvent([article], 1, clock.toISOString());
		await digest('all', {
			...defaults,
			tagging: (input) => ({
				items: input.articles.map((item) => ({
					ref: item.ref,
					category: 'geopolitics',
					regions: ['asia'],
					countries: [],
					tags: draft.tags.length > 0 ? draft.tags : ['water']
				}))
			}),
			relations: (input) => ({
				relations: input.candidates.map((candidate) => ({
					candidate_ref: candidate.ref,
					relation_type: 'follow_up',
					direction: 'event_to_candidate',
					explanation_th: 'เป็นความคืบหน้าต่อจากข่าวก่อนหน้า',
					evidence: [input.event.articles[0]!.ref],
					confidence
				}))
			})
		});
		return db.select().from(eventRelations).all();
	}

	it('policy all: a relation at or above the threshold is published without review', async () => {
		const relations = await relateNewEventWith(0.8);
		expect(relations.length).toBeGreaterThan(0);
		expect(relations.every((relation) => relation.status === 'published')).toBe(true);
		expect(relations.every((relation) => relation.reviewed_at === null)).toBe(true);
	});

	it('policy all: a relation below the threshold is dropped, not queued', async () => {
		expect(await relateNewEventWith(0.79)).toEqual([]);
	});

	it('an admin rejection blocks the pair for every relation type in later runs', async () => {
		await repositories.ingest.syncSources([...sourceRegistryFor('fixtures')]);
		const a = await repositories.digest.createDraftEvent(
			[await addArticle('fixture-wire-a', 'Story A')],
			1,
			NOW.toISOString()
		);
		const b = await repositories.digest.createDraftEvent(
			[await addArticle('fixture-wire-b', 'Story B')],
			1,
			NOW.toISOString()
		);
		const relation = (
			relation_type: 'follow_up' | 'same_topic' | 'background_of',
			from = a,
			to = b
		) => ({
			from_event_id: from,
			to_event_id: to,
			relation_type,
			explanation_th: 'เกี่ยวข้องกัน',
			evidence_refs: [],
			status: 'pending_review' as const,
			confidence: 0.9
		});

		expect(await repositories.digest.upsertRelation(relation('follow_up'))).toBe(true);
		const stored = db.select().from(eventRelations).get()!;
		await repositories.admin.reviewRelation(
			stored.id,
			'rejected',
			{ ...EDITOR, public_note_th: null },
			NOW.toISOString()
		);

		expect(await repositories.digest.upsertRelation(relation('follow_up'))).toBe(false);
		expect(await repositories.digest.upsertRelation(relation('same_topic'))).toBe(false);
		expect(await repositories.digest.upsertRelation(relation('background_of', b, a))).toBe(false);
		expect(db.select().from(eventRelations).all()).toMatchObject([
			{ id: stored.id, status: 'rejected' }
		]);
	});
});
