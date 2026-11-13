/**
 * `reevaluate_pending` (auto-publish wave): events held only by an older policy, published events
 * flagged `new_evidence_pending`, and pending relations, re-evaluated with the current policy.
 * Fixture feeds, an in-memory database and the mock LLM; no network.
 */
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import { contentRevisions, eventRelations, events } from '#lib/server/db/schema.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import type { AutoPublishPolicy } from '#lib/types/editorial.js';
import type { LlmTask, MockLlmHandlers } from '#lib/types/llm.js';
import type { Repositories } from '#lib/types/repositories.js';
import { SINGLE_SOURCE_FLOOR_REASON_TH } from '../editorial/index';
import { createDefaultMockHandlers, createMockLlmProvider } from '../llm/mock';
import { createFixtureAdapter } from '../news/adapters';
import { sourceRegistryFor } from '../news/sources';
import { runDigest } from './digest';
import { runIngest } from './ingest';
import { hourlyJobSlot } from './job-slots';
import { createJsonLogger } from './logger';
import { runReevaluatePending } from './reevaluate';
import { runJob } from './runner';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NOW = new Date('2026-11-13T00:00:00.000Z');

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
const policyRevisions = () =>
	db.select().from(contentRevisions).where(eq(contentRevisions.changed_by, 'system:policy')).all();

async function ingestFixtures() {
	await runJob(
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
}

/** The extraction calls an event sensitive when one of its article titles matches. */
function handlers(sensitiveTitles: readonly RegExp[] = []): MockLlmHandlers {
	const defaults = createDefaultMockHandlers();
	return {
		...defaults,
		extraction: (input) =>
			({
				...(defaults.extraction!(input) as object),
				sensitive: input.articles.some((article) =>
					sensitiveTitles.some((pattern) => pattern.test(article.title))
				)
			}) as never
	};
}

async function digest(policy: AutoPublishPolicy, mock: MockLlmHandlers = handlers()) {
	return runJob(
		{ jobs: repositories.jobs, logger: logger(), now: () => clock },
		{ job_type: 'digest', ...hourlyJobSlot('digest', clock), trigger: 'manual', force: true },
		(ctx) =>
			runDigest(
				{
					digest: repositories.digest,
					llm: createMockLlmProvider(mock),
					llmCalls: repositories.llmCalls,
					autoPublish: policy,
					relationMinConfidence: 0.8
				},
				ctx
			)
	);
}

function reevaluate(policy: AutoPublishPolicy, dryRun = false) {
	return runReevaluatePending(
		{
			reevaluation: repositories.reevaluation,
			autoPublish: policy,
			relationMinConfidence: 0.8,
			dryRun
		},
		{ now: () => clock, logger: logger(), signal: new AbortController().signal }
	);
}

async function addArticle(sourceId: string, title: string): Promise<string> {
	const n = ++articleCounter;
	const result = await repositories.ingest.insertArticleIfNew({
		source_id: sourceId,
		source_url: `https://fixtures.worldview.invalid/reevaluate/${n}`,
		canonical_url: `https://fixtures.worldview.invalid/reevaluate/${n}`,
		publisher_name: sourceId,
		title,
		excerpt: null,
		language: 'en',
		published_at: clock.toISOString(),
		ingested_at: clock.toISOString(),
		content_hash: `reevaluate-${n}`,
		raw_metadata: {}
	});
	return result.article_id;
}

/**
 * The production backlog: under `multi_source` the 3-source event is published, the single-source
 * ones wait (`auto_publish_disabled`), and the sensitive single-source one waits for G6.
 */
async function multiSourceBacklog() {
	await ingestFixtures();
	await digest('multi_source', handlers([/.*/]));
	const singles = allEvents().filter((row) => row.source_count === 1);
	// Rows stored before migration 0005 have no label.
	db.update(events).set({ credibility_level: 'none', credibility_reason_th: null }).run();
	// Make one single-source event non-sensitive, as if its extraction had said so.
	const plain = singles[0]!;
	db.update(events)
		.set({
			review_reasons: ['auto_publish_disabled'],
			signals: { ...plain.signals!, sensitive: false }
		})
		.where(eq(events.id, plain.id))
		.run();
	return {
		plain: plain.id,
		sensitive: singles.slice(1).map((row) => row.id),
		published: allEvents().find((row) => row.source_count === 3)!.id
	};
}

describe('reevaluate_pending: events', () => {
	it('dry run plans the publications and writes nothing', async () => {
		const backlog = await multiSourceBacklog();
		const before = allEvents();

		const outcome = await reevaluate('all', true);

		expect(outcome.status).toBe('succeeded');
		expect(outcome.counters).toMatchObject({
			events_reevaluated: 3,
			events_published: 3,
			events_skipped: 0
		});
		expect(allEvents()).toEqual(before);
		expect(policyRevisions()).toEqual([]);
		expect(eventById(backlog.plain).status).toBe('pending_review');
	});

	it('all: publishes policy-held events with the credibility floor and an audit row each', async () => {
		const backlog = await multiSourceBacklog();
		expect(eventById(backlog.sensitive[0]!).review_reasons).toEqual(['sensitive_single_source']);
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);

		const outcome = await reevaluate('all');

		expect(outcome.counters).toMatchObject({ events_reevaluated: 3, events_published: 3 });
		expect(eventById(backlog.plain)).toMatchObject({
			status: 'published',
			review_reasons: [],
			published_at: clock.toISOString(),
			credibility_level: 'none',
			credibility_reason_th: null
		});
		for (const id of backlog.sensitive) {
			expect(eventById(id)).toMatchObject({
				status: 'published',
				credibility_level: 'unverified',
				credibility_reason_th: SINGLE_SOURCE_FLOOR_REASON_TH
			});
		}
		const revisions = policyRevisions();
		expect(revisions).toHaveLength(3);
		const sensitiveRevision = revisions.find((row) => row.entity_id === backlog.sensitive[0])!;
		expect(sensitiveRevision).toMatchObject({
			entity_type: 'event',
			change_reason: 'policy re-evaluation (EDITORIAL_AUTO_PUBLISH=all)'
		});
		expect(sensitiveRevision.before_after).toEqual({
			before: {
				status: 'pending_review',
				review_reasons: ['sensitive_single_source'],
				credibility_level: 'none',
				credibility_reason_th: null
			},
			after: {
				status: 'published',
				review_reasons: [],
				credibility_level: 'unverified',
				credibility_reason_th: SINGLE_SOURCE_FLOOR_REASON_TH
			}
		});
		// Public pages show them now.
		expect(await repositories.read.getPublishedEventDetail(backlog.plain)).not.toBeNull();
	});

	it('is idempotent: a second run changes nothing', async () => {
		await multiSourceBacklog();
		await reevaluate('all');
		const after = allEvents();

		const again = await reevaluate('all');

		expect(again.counters).toMatchObject({ events_reevaluated: 0, events_published: 0 });
		expect(allEvents()).toEqual(after);
		expect(policyRevisions()).toHaveLength(3);
	});

	it('multi_source: nothing changes (same policy, same reasons)', async () => {
		await multiSourceBacklog();
		const before = allEvents();
		const outcome = await reevaluate('multi_source');
		expect(outcome.counters).toMatchObject({ events_reevaluated: 3, events_pending_review: 3 });
		expect(allEvents()).toEqual(before);
		expect(policyRevisions()).toEqual([]);
	});

	it('real gate failures stay pending; mixed reasons are not touched at all', async () => {
		const backlog = await multiSourceBacklog();
		// Policy-only reasons, but the stored text now fails G3: real reason recorded, not published.
		db.update(events)
			.set({ summary_th: 'ติดต่อ โทร 081-234-5678' })
			.where(eq(events.id, backlog.plain))
			.run();
		// A real failure next to a policy reason: not listed.
		db.update(events)
			.set({ review_reasons: ['sensitive_single_source', 'unsupported_claim'] })
			.where(eq(events.id, backlog.sensitive[0]!))
			.run();
		const mixedBefore = eventById(backlog.sensitive[0]!);

		const outcome = await reevaluate('all');

		expect(outcome.counters).toMatchObject({ events_reevaluated: 2, events_pending_review: 1 });
		expect(eventById(backlog.plain)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['contact_in_generated_text']
		});
		expect(eventById(backlog.sensitive[0]!)).toEqual(mixedBefore);
	});

	it('skips a row an admin changed after it was listed (the next run sees it again)', async () => {
		const backlog = await multiSourceBacklog();
		const listed = eventById(backlog.plain);
		db.update(events)
			.set({ updated_at: '2026-11-13T05:00:00.000Z' })
			.where(eq(events.id, backlog.plain))
			.run();
		const written = await repositories.reevaluation.applyEventDecision(
			backlog.plain,
			{
				status: 'published',
				review_reasons: [],
				credibility_level: 'none',
				credibility_reason_th: null
			},
			{ updated_at: listed.updated_at, status: listed.status },
			'test',
			clock.toISOString(),
			(tags) => tags
		);
		expect(written).toBeNull();
		expect(eventById(backlog.plain).status).toBe('pending_review');
	});

	it('an unpublished event an admin edited waits for that admin (manual_flag), as in the digest', async () => {
		const backlog = await multiSourceBacklog();
		const id = backlog.sensitive[0]!;
		const row = eventById(id);
		await repositories.admin.updateEventIfCurrent(
			id,
			row.updated_at,
			{ credibility_level: 'disputed', credibility_reason_th: 'ตัวเลขยังไม่ตรงกัน' },
			{ changed_by: 'editor@example.com', change_reason: 'ตั้งป้าย', public_note_th: null },
			clock.toISOString()
		);

		const dry = await reevaluate('all', true);
		expect(dry.counters).toMatchObject({ events_published: 2, events_pending_review: 1 });
		const outcome = await reevaluate('all');

		expect(outcome.counters).toMatchObject({ events_published: 2, events_pending_review: 1 });
		expect(eventById(id)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['manual_flag'],
			published_at: null,
			// The admin's label is kept.
			credibility_level: 'disputed',
			credibility_reason_th: 'ตัวเลขยังไม่ตรงกัน'
		});
		// manual_flag is not a policy reason: later runs leave it to the admin.
		expect((await reevaluate('all')).counters.events_reevaluated).toBe(0);
	});

	it('policy revisions never lock the label against a re-summary', async () => {
		const backlog = await multiSourceBacklog();
		await reevaluate('all');

		// A system:policy revision is a pipeline change: the next re-summary may set the label.
		const plain = backlog.sensitive[1]!;
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const joined = await addArticle('fixture-wire-c', 'Late follow-up');
		await repositories.digest.linkArticles(plain, [joined], 1, clock.toISOString());
		const defaults = createDefaultMockHandlers();
		await digest('all', {
			...defaults,
			summary: (input) =>
				({
					...(defaults.summary!(input) as object),
					credibility_level: 'disputed',
					credibility_reason_th: 'รายงานแต่ละแหล่งไม่ตรงกัน'
				}) as never
		});
		expect(eventById(plain)).toMatchObject({
			credibility_level: 'disputed',
			credibility_reason_th: 'รายงานแต่ละแหล่งไม่ตรงกัน'
		});
	});
});

describe('reevaluate_pending: new evidence on published events', () => {
	it('all: clears new_evidence_pending so the next digest re-summarizes with the new article', async () => {
		await ingestFixtures();
		await digest('all');
		const target = allEvents().find((row) => row.source_count === 3)!;
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const joined = await addArticle('fixture-wire-b', 'Kessel accord follow-up');
		await repositories.digest.linkArticles(target.id, [joined], 1, clock.toISOString());
		await digest('multi_source');
		expect(eventById(target.id).review_reasons).toEqual(['new_evidence_pending']);

		clock = new Date(clock.getTime() + 60 * 60 * 1000);
		const outcome = await reevaluate('all');

		expect(outcome.counters.events_requeued).toBe(1);
		const requeued = eventById(target.id);
		expect(requeued.review_reasons).toEqual([]);
		expect(requeued.summarized_at! < clock.toISOString()).toBe(true);
		expect(policyRevisions().map((row) => row.entity_id)).toEqual([target.id]);

		const counts: Partial<Record<LlmTask, number>> = {};
		const defaults = createDefaultMockHandlers();
		clock = new Date(clock.getTime() + 60 * 60 * 1000);
		await digest('all', {
			...defaults,
			summary: (input) => {
				counts.summary = (counts.summary ?? 0) + 1;
				return defaults.summary!(input);
			}
		});
		expect(counts.summary).toBe(1);
		expect(eventById(target.id)).toMatchObject({ status: 'published', review_reasons: [] });
	});

	it('multi_source / off: the flag stays for the admin', async () => {
		await ingestFixtures();
		await digest('all');
		const target = allEvents().find((row) => row.source_count === 3)!;
		db.update(events)
			.set({ review_reasons: ['new_evidence_pending'] })
			.where(eq(events.id, target.id))
			.run();
		for (const policy of ['multi_source', 'off'] as const) {
			const outcome = await reevaluate(policy);
			expect(outcome.counters.events_requeued).toBe(0);
		}
		expect(eventById(target.id).review_reasons).toEqual(['new_evidence_pending']);
	});
});

describe('reevaluate_pending: relations', () => {
	async function publishedEvents() {
		await ingestFixtures();
		await digest('all');
		return allEvents().map((row) => row.id);
	}
	async function pending(from: string, to: string, confidence: number, type = 'follow_up') {
		const detail = await repositories.read.getPublishedEventDetail(from);
		await repositories.digest.upsertRelation({
			from_event_id: from,
			to_event_id: to,
			relation_type: type as 'follow_up',
			explanation_th: 'เป็นความคืบหน้าต่อจากข่าวก่อนหน้า',
			evidence_refs: [{ article_id: detail!.sources[0]!.article_id }],
			status: 'pending_review',
			confidence
		});
		return db
			.select()
			.from(eventRelations)
			.where(and(eq(eventRelations.from_event_id, from), eq(eventRelations.to_event_id, to)))
			.get()!;
	}

	it('all: publishes at or above the threshold and drops below it, with audit rows', async () => {
		const [a, b, c] = await publishedEvents();
		const confident = await pending(a!, b!, 0.8);
		const weak = await pending(a!, c!, 0.6);

		const dry = await reevaluate('all', true);
		expect(dry.counters).toMatchObject({ relations_published: 1, relations_dropped: 1 });
		expect(db.select().from(eventRelations).all()).toHaveLength(2);

		const outcome = await reevaluate('all');

		expect(outcome.counters).toMatchObject({
			relations_reevaluated: 2,
			relations_published: 1,
			relations_dropped: 1
		});
		const rows = db.select().from(eventRelations).all();
		expect(rows.map((row) => [row.id, row.status, row.reviewed_at])).toEqual([
			[confident.id, 'published', null]
		]);
		const audit = db
			.select()
			.from(contentRevisions)
			.where(eq(contentRevisions.entity_type, 'event_relation'))
			.all();
		expect(audit.map((row) => [row.entity_id, row.changed_by])).toEqual(
			expect.arrayContaining([
				[confident.id, 'system:policy'],
				[weak.id, 'system:policy']
			])
		);
		expect(audit.find((row) => row.entity_id === weak.id)!.before_after.before).toMatchObject({
			id: weak.id,
			confidence: 0.6
		});
		// Idempotent.
		expect((await reevaluate('all')).counters.relations_reevaluated).toBe(0);
	});

	it('drops a pending relation of a pair an admin rejected', async () => {
		const [a, b] = await publishedEvents();
		const rejected = await pending(a!, b!, 0.9, 'background_of');
		await repositories.admin.reviewRelation(
			rejected.id,
			'rejected',
			{ changed_by: 'editor@example.com', change_reason: 'ไม่เกี่ยวข้อง', public_note_th: null },
			clock.toISOString()
		);
		// Stored directly (the digest would refuse): a pending one for the same pair.
		db.insert(eventRelations)
			.values({
				...rejected,
				id: 'pending-after-reject',
				relation_type: 'follow_up',
				status: 'pending_review',
				reviewed_at: null,
				reviewed_by: null
			})
			.run();

		const outcome = await reevaluate('all');

		expect(outcome.counters).toMatchObject({ relations_dropped: 1, relations_published: 0 });
		expect(
			db.select().from(eventRelations).where(eq(eventRelations.id, 'pending-after-reject')).get()
		).toBeUndefined();
	});

	it('does nothing to relations in multi_source / off', async () => {
		const [a, b] = await publishedEvents();
		await pending(a!, b!, 0.95);
		for (const policy of ['multi_source', 'off'] as const) {
			expect((await reevaluate(policy)).counters.relations_reevaluated).toBe(0);
		}
		expect(db.select().from(eventRelations).all()[0]!.status).toBe('pending_review');
	});

	it('never publishes a possible-duplicate relation, even after the draft was published', async () => {
		const [published] = await publishedEvents();
		const draft = await repositories.digest.createDraftEvent(
			[await addArticle('fixture-wire-a', 'Duplicate report')],
			1,
			clock.toISOString()
		);
		const detail = await repositories.read.getPublishedEventDetail(published!);
		await repositories.digest.flagPossibleDuplicate(
			draft,
			published!,
			{
				explanation_th: 'น่าจะเป็นเหตุการณ์เดียวกัน',
				evidence_article_ids: [detail!.sources[0]!.article_id],
				confidence: 0.99
			},
			clock.toISOString()
		);
		const duplicate = db.select().from(eventRelations).get()!;
		expect(duplicate.origin).toBe('possible_duplicate');
		// The admin published the draft as its own event; the relation still waits.
		db.update(events)
			.set({ status: 'published', review_reasons: [], published_at: clock.toISOString() })
			.where(eq(events.id, draft))
			.run();

		const outcome = await reevaluate('all');
		expect(outcome.counters.relations_reevaluated).toBe(0);
		expect(await repositories.reevaluation.publishPendingRelation(duplicate.id, 'x', 'now')).toBe(
			false
		);
		// The relations task cannot take the edge over either.
		expect(
			await repositories.digest.upsertRelation({
				from_event_id: duplicate.from_event_id,
				to_event_id: duplicate.to_event_id,
				relation_type: 'same_topic',
				explanation_th: 'เรื่องเดียวกัน',
				evidence_refs: duplicate.evidence_refs,
				status: 'published',
				confidence: 0.99
			})
		).toBe(false);
		expect(db.select().from(eventRelations).get()).toMatchObject({
			id: duplicate.id,
			status: 'pending_review',
			origin: 'possible_duplicate'
		});
	});

	it('publishPendingRelation re-checks a rejection made after the relation was listed', async () => {
		const [a, b] = await publishedEvents();
		const relation = await pending(a!, b!, 0.95);
		const listed = await repositories.reevaluation.listPendingRelations();
		expect(listed.map((item) => item.relation.id)).toEqual([relation.id]);
		// Meanwhile an admin rejects another relation of the same pair.
		db.insert(eventRelations)
			.values({
				...relation,
				id: 'rejected-sibling',
				relation_type: 'background_of',
				status: 'rejected',
				reviewed_at: clock.toISOString(),
				reviewed_by: 'editor@example.com'
			})
			.run();

		expect(
			await repositories.reevaluation.publishPendingRelation(relation.id, 'x', clock.toISOString())
		).toBe(false);
		expect(
			db.select().from(eventRelations).where(eq(eventRelations.id, relation.id)).get()!.status
		).toBe('pending_review');
	});
});
