/**
 * Digest end to end on fixture feeds and an in-memory database, with the mock LLM provider (no
 * network). Covers acceptance #9 (LLM failure), the editorial invariants digest must keep
 * (hidden / manual_flag untouched, relation evidence, causal relations pending, existing lesson
 * ids only), ambiguous clustering and `--max-events`.
 */
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import { createRepositories } from '#lib/server/db/repositories/index.js';
import {
	articles,
	contentRevisions,
	eventArticles,
	eventLessonLinks,
	eventRelations,
	events
} from '#lib/server/db/schema.js';
import { openTestDb } from '#lib/server/db/test-db.js';
import type { AcademyLessonRow } from '#lib/types/domain.js';
import type { LlmCallRepository, Repositories } from '#lib/types/repositories.js';
import type { MockLlmHandlers, SummaryInput, SummaryOutput } from '#lib/types/llm.js';
import { createDefaultMockHandlers, createMockLlmProvider, mockLlmError } from '../llm/mock';
import { createFixtureAdapter } from '../news/adapters';
import { sourceRegistryFor } from '../news/sources';
import { runDigest, type DigestDeps } from './digest';
import { runIngest } from './ingest';
import { hourlyJobSlot } from './job-slots';
import { createJsonLogger } from './logger';
import { runJob } from './runner';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NOW = new Date('2026-11-13T00:00:00.000Z'); // 07:00 ICT

const LESSONS: AcademyLessonRow[] = [
	lesson('w1-d01', 1, ['water', 'treaties'], ['geopolitics']),
	lesson('w2-d08', 8, ['interest-rates'], ['economy'])
];

let db: Db;
let repositories: Repositories;
let clock: Date;

beforeEach(async () => {
	db = openTestDb();
	repositories = createRepositories(db);
	clock = NOW;
	await repositories.academy.replaceLessonCatalog(LESSONS);
});
afterEach(() => db.$client.close());

const logger = () =>
	createJsonLogger(
		() => {},
		() => clock
	);

/** Deterministic, schema-valid handlers: every story is geopolitics/asia with the "water" tag. */
function handlers(overrides: MockLlmHandlers = {}): MockLlmHandlers {
	const defaults = createDefaultMockHandlers();
	return {
		...defaults,
		tagging: (input) => ({
			items: input.articles.map((article) => ({
				ref: article.ref,
				category: /bank|rate/i.test(article.title) ? 'economy' : 'geopolitics',
				regions: ['asia'],
				countries: [],
				tags: ['water']
			}))
		}),
		summary: (input) => ({
			...defaultSummary(input),
			claims_th: [
				{
					claimant_th: 'เจ้าหน้าที่',
					claim_th: 'ข้อตกลงจะมีผลในเดือนหน้า',
					evidence: [input.articles[0]!.ref]
				}
			]
		}),
		...overrides
	};
}

/** The default mock summary never fails, so it is always a `SummaryOutput`. */
function defaultSummary(input: SummaryInput): SummaryOutput {
	return createDefaultMockHandlers().summary(input) as SummaryOutput;
}

async function ingestFixtures() {
	return runJob(
		{ jobs: repositories.jobs, logger: logger(), now: () => clock },
		{
			job_type: 'ingest',
			...hourlyJobSlot('ingest', clock, 'fixtures'),
			trigger: 'cron',
			force: false
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

async function digest(mock: MockLlmHandlers = handlers(), overrides: Partial<DigestDeps> = {}) {
	const result = await runJob(
		{ jobs: repositories.jobs, logger: logger(), now: () => clock },
		{ job_type: 'digest', ...hourlyJobSlot('digest', clock), trigger: 'manual', force: true },
		(ctx) =>
			runDigest(
				{
					digest: repositories.digest,
					llm: createMockLlmProvider(mock),
					llmCalls: repositories.llmCalls,
					...overrides
				},
				ctx
			)
	);
	if (result.status === 'skipped') throw new Error('digest was skipped');
	return result;
}

const allEvents = () => db.select().from(events).all();
const eventById = (id: string) => db.select().from(events).where(eq(events.id, id)).get()!;

describe('digest on fixture feeds', () => {
	it('ingest → digest publishes every event with Thai text, stored sources and real evidence ids', async () => {
		await ingestFixtures();
		const usage: Pick<LlmCallRepository, 'usageForJobRun'> = {
			usageForJobRun: async () => ({ requests: 7, tokens: 1234 })
		};
		const result = await digest(handlers(), { llmCalls: usage });

		expect(result.status).toBe('succeeded');
		expect(result.counters).toMatchObject({
			events_published: 4,
			events_pending_review: 0,
			llm_failures: 0,
			llm_requests: 7,
			llm_tokens: 1234
		});
		expect(result.counters.lesson_links).toBeGreaterThan(0);
		expect(
			db
				.select()
				.from(articles)
				.all()
				.every((row) => row.taxonomy !== null)
		).toBe(true);

		const storedArticleIds = new Set(
			db
				.select()
				.from(articles)
				.all()
				.map((row) => row.id)
		);
		for (const row of allEvents()) {
			expect(row).toMatchObject({ status: 'published', review_reasons: [] });
			expect(row.title_th).toMatch(/\p{Script=Thai}/u);
			expect(row.category).not.toBeNull();
			expect(row.signals).toEqual({ impact_breadth: 1, thailand_relevance: 1, sensitive: false });

			const detail = await repositories.read.getPublishedEventDetail(row.id);
			expect(detail?.sources.length).toBeGreaterThanOrEqual(1);
			const evidence = row.claims.flatMap((claim) => claim.evidence_refs);
			expect(evidence.length).toBeGreaterThan(0);
			expect(evidence.every((ref) => storedArticleIds.has(ref.article_id))).toBe(true);
		}

		const kessel = allEvents().find((row) => row.source_count === 3)!;
		expect(kessel).toMatchObject({ category: 'geopolitics', regions: ['asia'], tags: ['water'] });
		const links = db.select().from(eventLessonLinks).all();
		expect(links.every((link) => LESSONS.some((lesson) => lesson.id === link.lesson_id))).toBe(
			true
		);
	});

	it('--max-events bounds the events that get content', async () => {
		await ingestFixtures();
		const result = await digest(handlers(), { maxEvents: 1 });

		expect(result.counters.events_published).toBe(1);
		expect(allEvents().filter((row) => row.status === 'draft')).toHaveLength(3);
	});

	it('sends the stored excerpt to extraction and summary, and null where the source has none', async () => {
		const excerptsSent: Record<'extraction' | 'summary', (string | null)[]> = {
			extraction: [],
			summary: []
		};
		const defaults = handlers();
		await ingestFixtures();
		await digest({
			...defaults,
			extraction: (input) => {
				excerptsSent.extraction.push(...input.articles.map((article) => article.excerpt));
				return defaults.extraction!(input);
			},
			summary: (input) => {
				excerptsSent.summary.push(...input.articles.map((article) => article.excerpt));
				return defaults.summary!(input);
			}
		});

		const riverExcerpt =
			'The two fictional states agreed to share the river’s flow during dry months.';
		for (const sent of Object.values(excerptsSent)) {
			expect(sent).toContain(riverExcerpt);
			expect(sent).toContain(null); // wire B (Atom) does not allow excerpts
		}
	});
});

describe('digest failures and editorial invariants', () => {
	it('acceptance #9: an LLM timeout leaves a new event pending_review [llm_failed] and a published event unchanged', async () => {
		await ingestFixtures();
		await digest();
		const published = allEvents()[0]!;
		const before = eventById(published.id);

		// New evidence for the published event, plus a brand-new draft.
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const [joining, fresh] = await Promise.all([
			addArticle('Follow-up report'),
			addArticle('New story')
		]);
		await repositories.digest.linkArticles(published.id, [joining], 1, clock.toISOString());
		const draftId = await repositories.digest.createDraftEvent([fresh], 1, clock.toISOString());

		const result = await digest(handlers({ extraction: () => mockLlmError('timeout') }));

		expect(result.status).toBe('partial');
		expect(result.counters.llm_failures).toBeGreaterThan(0);
		expect(eventById(draftId)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['llm_failed'],
			title_th: ''
		});
		const after = eventById(published.id);
		expect(after).toMatchObject({
			status: 'published',
			title_th: before.title_th,
			summary_th: before.summary_th,
			summarized_at: before.summarized_at
		});

		// The next digest retries the llm_failed event automatically.
		clock = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
		await digest();
		expect(eventById(draftId).status).toBe('published');
	});

	it('never touches a hidden event or a published event an editor flagged', async () => {
		await ingestFixtures();
		await digest();
		const [hidden, flagged] = allEvents();
		db.update(events).set({ status: 'hidden' }).where(eq(events.id, hidden!.id)).run();
		db.update(events)
			.set({ review_reasons: ['manual_flag'] })
			.where(eq(events.id, flagged!.id))
			.run();
		const before = [eventById(hidden!.id), eventById(flagged!.id)];

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		for (const event of [hidden!, flagged!]) {
			const articleId = await addArticle(`More on ${event.id}`);
			await repositories.digest.linkArticles(event.id, [articleId], 1, clock.toISOString());
		}
		await digest(
			handlers({
				summary: (input) => ({
					...defaultSummary(input),
					title_th: 'ข้อความใหม่ที่ไม่ควรถูกบันทึก'
				})
			})
		);

		const after = [eventById(hidden!.id), eventById(flagged!.id)];
		for (const [index, row] of after.entries()) {
			expect(row).toMatchObject({
				status: before[index]!.status,
				title_th: before[index]!.title_th,
				summarized_at: before[index]!.summarized_at,
				review_reasons: before[index]!.review_reasons
			});
		}
	});

	it('stores no relation without evidence, and always keeps potential_impact for review', async () => {
		await ingestFixtures();
		await digest(
			handlers({
				relations: (input) => {
					const candidate = input.candidates[0]!;
					return {
						relations: [
							{
								candidate_ref: candidate.ref,
								relation_type: 'same_topic',
								direction: 'event_to_candidate',
								explanation_th: 'ทั้งสองเรื่องเกี่ยวกับแหล่งน้ำ',
								evidence: [],
								confidence: 0.9
							},
							{
								candidate_ref: candidate.ref,
								relation_type: 'potential_impact',
								direction: 'event_to_candidate',
								explanation_th: 'อาจส่งผลต่อการค้าในภูมิภาค',
								evidence: [input.event.articles[0]!.ref],
								confidence: 0.99
							}
						]
					};
				}
			})
		);

		const relations = db.select().from(eventRelations).all();
		expect(relations.length).toBeGreaterThan(0);
		expect(relations.every((relation) => relation.relation_type === 'potential_impact')).toBe(true);
		expect(relations.every((relation) => relation.status === 'pending_review')).toBe(true);
		expect(relations.every((relation) => relation.evidence_refs.length > 0)).toBe(true);
	});

	it('links only lessons that exist; an invented lesson id stores nothing', async () => {
		await ingestFixtures();
		await digest(
			handlers({
				academy_linking: (input) => ({
					links: [
						{ lesson_id: input.lessons[0]!.lesson_id, rationale_th: 'ให้พื้นฐานเรื่องสนธิสัญญา' },
						{ lesson_id: 'w9-d99', rationale_th: 'บทเรียนที่ไม่มีอยู่จริง' }
					]
				})
			})
		);
		expect(db.select().from(eventLessonLinks).all()).toHaveLength(0);

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const id = allEvents()[0]!.id;
		await repositories.digest.linkArticles(
			id,
			[await addArticle('Water talks')],
			1,
			clock.toISOString()
		);
		await digest();
		const links = db.select().from(eventLessonLinks).all();
		expect(links.map((link) => link.lesson_id)).toEqual(['w1-d01']);
	});
});

describe('ambiguous clustering', () => {
	async function twoAmbiguousDrafts(): Promise<[string, string]> {
		const accord = await addArticle(
			'Avalor and Meridia sign Kessel River water-sharing accord',
			'2026-11-12T10:00:00.000Z'
		);
		const trade = await addArticle(
			'Avalor and Meridia sign trade accord',
			'2026-11-12T11:00:00.000Z'
		);
		const now = clock.toISOString();
		return [
			await repositories.digest.createDraftEvent([accord], 1, now),
			await repositories.digest.createDraftEvent([trade], 1, now)
		];
	}

	it('merges a draft into the other event on a confident same_event', async () => {
		await twoAmbiguousDrafts();
		const result = await digest(
			handlers({
				clustering: (input) => ({
					decisions: input.pairs.map((pair) => ({
						pair_ref: pair.pair_ref,
						verdict: 'same_event',
						confidence: 0.9
					}))
				})
			})
		);

		expect(allEvents()).toHaveLength(1);
		expect(db.select().from(eventArticles).all()).toHaveLength(2);
		expect(allEvents()[0]).toMatchObject({ status: 'published', source_count: 1 });
		expect(result.counters.events_updated).toBe(1);
	});

	it('keeps them separate when the LLM says related, or fails', async () => {
		const ids = await twoAmbiguousDrafts();
		await digest(
			handlers({
				clustering: (input) => ({
					decisions: input.pairs.map((pair) => ({
						pair_ref: pair.pair_ref,
						verdict: 'related',
						confidence: 0.9
					}))
				})
			})
		);
		expect(db.select().from(events).where(inArray(events.id, ids)).all()).toHaveLength(2);
	});
});

let articleCounter = 0;
async function addArticle(title: string, publishedAt = clock.toISOString()): Promise<string> {
	const n = ++articleCounter;
	await repositories.ingest.syncSources([...sourceRegistryFor('fixtures')]);
	const result = await repositories.ingest.insertArticleIfNew({
		source_id: 'fixture-wire-a',
		source_url: `https://fixtures.worldview.invalid/extra/${n}`,
		canonical_url: `https://fixtures.worldview.invalid/extra/${n}`,
		publisher_name: 'Fixture Wire A',
		title,
		excerpt: null,
		language: 'en',
		published_at: publishedAt,
		ingested_at: clock.toISOString(),
		content_hash: `extra-${n}`,
		raw_metadata: {}
	});
	return result.article_id;
}

function lesson(
	id: string,
	day: number,
	tags: string[],
	categories: AcademyLessonRow['categories']
): AcademyLessonRow {
	return {
		id,
		week: day <= 7 ? 1 : 2,
		day,
		slug: id,
		title: `บทเรียน ${id}`,
		summary: 'สรุปบทเรียน',
		content_path: `content/academy/${id}.md`,
		tags,
		categories,
		search_text: 'เนื้อหา'
	};
}

describe('admin corrections survive the pipeline (PRD FR-06)', () => {
	const editor = { changed_by: 'editor@example.com', change_reason: 'fix a factual error' };
	const resummary = handlers({
		summary: (input) => ({
			...defaultSummary(input),
			title_th: 'หัวข้อใหม่จากการสรุปซ้ำ',
			summary_th: 'สรุปใหม่จากหลักฐานเพิ่มเติม'
		})
	});

	async function linkNewArticle(eventId: string) {
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		const articleId = await addArticle(`New evidence for ${eventId}`);
		await repositories.digest.linkArticles(eventId, [articleId], 1, clock.toISOString());
	}

	it('keeps the admin-edited text of a published event when new evidence arrives', async () => {
		await ingestFixtures();
		await digest();
		const id = allEvents()[0]!.id;
		await repositories.admin.updateEvent(
			id,
			{ title_th: 'หัวข้อที่บรรณาธิการแก้ไขแล้ว' },
			{ ...editor, public_note_th: 'แก้ไขข้อเท็จจริง' },
			NOW.toISOString()
		);

		await linkNewArticle(id);
		await digest(resummary);

		expect(eventById(id)).toMatchObject({
			status: 'published',
			title_th: 'หัวข้อที่บรรณาธิการแก้ไขแล้ว',
			// A field the admin did not touch is still refreshed from the new evidence.
			summary_th: 'สรุปใหม่จากหลักฐานเพิ่มเติม',
			summarized_at: clock.toISOString()
		});

		// Still kept on the next re-summary, after summarized_at has moved past the admin edit.
		await linkNewArticle(id);
		clock = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
		await digest(resummary);
		expect(eventById(id).title_th).toBe('หัวข้อที่บรรณาธิการแก้ไขแล้ว');
	});

	it('re-summarizes an event no admin edited, as before', async () => {
		await ingestFixtures();
		await digest();
		const id = allEvents()[0]!.id;

		await linkNewArticle(id);
		await digest(resummary);

		expect(eventById(id)).toMatchObject({
			status: 'published',
			title_th: 'หัวข้อใหม่จากการสรุปซ้ำ',
			summary_th: 'สรุปใหม่จากหลักฐานเพิ่มเติม'
		});
	});

	it('does not auto-publish an unpublished event an admin edited; it waits for the admin', async () => {
		await ingestFixtures();
		await digest(handlers({ extraction: () => mockLlmError('timeout') }));
		const id = allEvents()[0]!.id;
		expect(eventById(id)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['llm_failed']
		});
		await repositories.admin.updateEvent(
			id,
			{ title_th: 'ร่างหัวข้อของบรรณาธิการ' },
			{ ...editor, public_note_th: null },
			NOW.toISOString()
		);

		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		await digest(resummary);

		expect(eventById(id)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['manual_flag'],
			title_th: 'ร่างหัวข้อของบรรณาธิการ',
			summary_th: 'สรุปใหม่จากหลักฐานเพิ่มเติม'
		});
	});
});

// ---------------------------------------------------------------------------
// Wave 2 review regressions (probe-digest/probe1.mts scenarios A, B, C and findings 6–8)
// ---------------------------------------------------------------------------

/** Handlers that count every task call. */
function counted(mock: MockLlmHandlers = handlers()) {
	const calls: Record<string, number> = {};
	const wrapped = Object.fromEntries(
		Object.entries(mock).map(([task, handler]) => [
			task,
			(input: never) => {
				calls[task] = (calls[task] ?? 0) + 1;
				return (handler as (input: never) => unknown)(input);
			}
		])
	) as MockLlmHandlers;
	return { mock: wrapped, calls };
}

const sameEventClustering = handlers({
	clustering: (input) => ({
		decisions: input.pairs.map((pair) => ({
			pair_ref: pair.pair_ref,
			verdict: 'same_event',
			confidence: 0.9
		}))
	})
});

async function ambiguousDraftsAndAnUnrelatedOne(): Promise<[string, string, string]> {
	const now = clock.toISOString();
	const accord = await addArticle(
		'Avalor and Meridia sign Kessel River water-sharing accord',
		'2026-11-12T10:00:00.000Z'
	);
	const trade = await addArticle(
		'Avalor and Meridia sign trade accord',
		'2026-11-12T11:00:00.000Z'
	);
	const volcano = await addArticle(
		'Unrelated volcano erupts in Zembla',
		'2026-11-12T12:00:00.000Z'
	);
	return [
		await repositories.digest.createDraftEvent([accord], 1, now),
		await repositories.digest.createDraftEvent([trade], 1, now),
		await repositories.digest.createDraftEvent([volcano], 1, now)
	];
}

describe('review #1: a failing step or unit never fails the run', () => {
	it('probe B: a merge whose target was hidden meanwhile is skipped; the run is partial and continues', async () => {
		const [, , volcano] = await ambiguousDraftsAndAnUnrelatedOne();
		const hidingRepo = {
			...repositories.digest,
			async mergeDraftEvent(source: string, target: string, confidence: number, now: string) {
				db.update(events).set({ status: 'hidden' }).where(eq(events.id, target)).run();
				return repositories.digest.mergeDraftEvent(source, target, confidence, now);
			}
		};

		const result = await digest(sameEventClustering, { digest: hidingRepo });

		expect(result.status).toBe('partial');
		expect(eventById(volcano).status).toBe('published');
		const run = (await repositories.jobs.listRecent(1))[0]!;
		expect(run.error).toMatch(/merge .*cannot merge a draft event into a hidden event/);
	});

	it('an EntityNotFoundError from a merge (another job removed the draft) is skipped', async () => {
		const [, , volcano] = await ambiguousDraftsAndAnUnrelatedOne();
		const racingRepo = {
			...repositories.digest,
			async mergeDraftEvent(source: string, target: string, confidence: number, now: string) {
				db.delete(events).where(eq(events.id, source)).run();
				return repositories.digest.mergeDraftEvent(source, target, confidence, now);
			}
		};

		const result = await digest(sameEventClustering, { digest: racingRepo });

		expect(result.status).toBe('partial');
		expect((await repositories.jobs.listRecent(1))[0]!.error).toMatch(/EntityNotFoundError/);
		expect(eventById(volcano).status).toBe('published');
	});

	it('a concurrent "already linked" grouping error is skipped and the drafts still get content', async () => {
		const [, , volcano] = await ambiguousDraftsAndAnUnrelatedOne();
		await addArticle('Unassigned report on Port Selene ferries');
		const racingRepo = {
			...repositories.digest,
			async createDraftEvent(): Promise<string> {
				throw new Error('createDraftEvent: all articles are already linked to an event');
			}
		};

		const result = await digest(handlers(), { digest: racingRepo });

		expect(result.status).toBe('partial');
		expect((await repositories.jobs.listRecent(1))[0]!.error).toMatch(/grouping: .*already linked/);
		expect(eventById(volcano).status).toBe('published');
	});
});

describe('review #2/#7: keep_published is not reprocessed forever', () => {
	it('probe A: a published event an editor flagged is never sent to the LLM again', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Kessel River accord signed')],
			1,
			clock.toISOString()
		);
		await digest();
		db.update(events)
			.set({ review_reasons: ['manual_flag'] })
			.where(eq(events.id, id))
			.run();
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		await repositories.digest.linkArticles(
			id,
			[await addArticle('Kessel River accord follow-up')],
			1,
			clock.toISOString()
		);

		for (let run = 1; run <= 3; run++) {
			clock = new Date(NOW.getTime() + (run + 1) * 60 * 60 * 1000);
			const { mock, calls } = counted();
			await digest(mock);
			expect(calls).toEqual({});
		}
		expect(await repositories.digest.listEventsNeedingContent(30)).toEqual([]);
		expect(eventById(id).status).toBe('published');
	});

	it('a re-summary rejected by the gates is checked once, then waits for newer evidence', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Port Selene opens ferry line')],
			1,
			clock.toISOString()
		);
		await digest();
		const before = eventById(id);
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		await repositories.digest.linkArticles(
			id,
			[await addArticle('Ferry follow-up')],
			1,
			clock.toISOString()
		);
		const urlInText = handlers({
			summary: (input) => ({ ...defaultSummary(input), summary_th: 'ดูต่อที่ www.example.com' })
		});

		const first = counted(urlInText);
		await digest(first.mock);
		expect(first.calls.summary).toBe(1);
		expect(eventById(id)).toMatchObject({
			title_th: before.title_th,
			summarized_at: clock.toISOString()
		});

		clock = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
		const second = counted(urlInText);
		await digest(second.mock);
		expect(second.calls).toEqual({});

		// New evidence brings it back.
		await repositories.digest.linkArticles(
			id,
			[await addArticle('Ferry second follow-up')],
			1,
			clock.toISOString()
		);
		clock = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
		const third = counted();
		await digest(third.mock);
		expect(third.calls.summary).toBe(1);
	});

	it('a transient LLM failure on a published event is retried by the next run', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Northland rate decision')],
			1,
			clock.toISOString()
		);
		await digest();
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		await repositories.digest.linkArticles(
			id,
			[await addArticle('Rate follow-up')],
			1,
			clock.toISOString()
		);

		await digest(handlers({ summary: () => mockLlmError('timeout') }));
		expect((await repositories.digest.listEventsNeedingContent(30)).map((e) => e.event.id)).toEqual(
			[id]
		);
	});

	it('#7: an article linked while the LLM works triggers the next re-summary', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Avalor census results')],
			1,
			clock.toISOString()
		);
		const mockProvider = createMockLlmProvider(handlers());
		let linked = false;
		const slowProvider: typeof mockProvider = {
			async run(task, input, options) {
				if (task === 'summary' && !linked) {
					linked = true;
					// Another job links new evidence while the summary is being written.
					const later = new Date(clock.getTime() + 60 * 1000).toISOString();
					await repositories.digest.linkArticles(
						id,
						[await addArticle('Census update', later)],
						1,
						later
					);
				}
				return mockProvider.run(task, input, options);
			}
		};

		await digest(handlers(), { llm: slowProvider });

		expect(eventById(id).status).toBe('published');
		expect((await repositories.digest.listEventsNeedingContent(30)).map((e) => e.event.id)).toEqual(
			[id]
		);
	});
});

describe('review #3: merges never lose admin work', () => {
	it('probe C: admin-edited drafts are not merged away; their edits and revisions stay', async () => {
		const [accord, trade] = await ambiguousDraftsAndAnUnrelatedOne();
		for (const id of [accord, trade]) {
			await repositories.admin.updateEvent(
				id,
				{ title_th: `หัวข้อของบรรณาธิการ ${id.slice(0, 4)}` },
				{ changed_by: 'editor@example.com', change_reason: 'x', public_note_th: null },
				clock.toISOString()
			);
		}

		const result = await digest(sameEventClustering);

		expect(result.counters.events_updated).toBe(0);
		for (const id of [accord, trade]) {
			expect(eventById(id).title_th).toBe(`หัวข้อของบรรณาธิการ ${id.slice(0, 4)}`);
		}
		const revisionTargets = db
			.select()
			.from(contentRevisions)
			.all()
			.map((row) => row.entity_id);
		expect(revisionTargets.every((id) => allEvents().some((event) => event.id === id))).toBe(true);
	});
});

describe('review #6: links use the stored row, not the discarded LLM text', () => {
	it('relations and lessons see the admin-kept category and tags', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Northland holds talks')],
			1,
			clock.toISOString()
		);
		await digest();
		await repositories.admin.updateEvent(
			id,
			{ category: 'economy', tags: ['interest-rates'] },
			{ changed_by: 'editor@example.com', change_reason: 'recategorize', public_note_th: null },
			clock.toISOString()
		);
		clock = new Date(NOW.getTime() + 60 * 60 * 1000);
		await repositories.digest.linkArticles(
			id,
			[await addArticle('Northland talks continue')],
			1,
			clock.toISOString()
		);

		let seen: { category: string; tags: string[]; lessons: string[] } | null = null;
		await digest(
			handlers({
				academy_linking: (input) => {
					seen = {
						category: input.event.category,
						tags: input.event.tags,
						lessons: input.lessons.map((lesson) => lesson.lesson_id)
					};
					return { links: [] };
				}
			})
		);

		expect(seen).toEqual({ category: 'economy', tags: ['interest-rates'], lessons: ['w2-d08'] });
	});
});

describe('review #8: tagging errors are tracked per article', () => {
	it('an event whose tagging returned invalid output is retried (llm_failed), not sent to a human', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Untaggable story')],
			1,
			clock.toISOString()
		);

		await digest(handlers({ tagging: () => mockLlmError('invalid_output') }));

		expect(eventById(id)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['llm_failed']
		});
	});

	it('a request that can never succeed goes to a human (llm_request_rejected)', async () => {
		const id = await repositories.digest.createDraftEvent(
			[await addArticle('Oversized story')],
			1,
			clock.toISOString()
		);

		await digest(handlers({ tagging: () => mockLlmError('input_too_large') }));

		expect(eventById(id)).toMatchObject({
			status: 'pending_review',
			review_reasons: ['llm_request_rejected']
		});
	});
});
