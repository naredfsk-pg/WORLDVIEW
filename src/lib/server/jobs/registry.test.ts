/**
 * `runJobByType` wiring: usage errors, then ingest (fixtures) → digest → brief → archive through
 * the real composition root against a temporary database file. The LLM endpoint is forced to
 * "not configured", so digest runs without any network and every event waits for review.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '#lib/server/db/client.js';
import { events, jobRuns } from '#lib/server/db/schema.js';
import { runJobByType } from './registry';

const MIGRATIONS = fileURLToPath(new URL('../../../../migrations', import.meta.url));
let dir: string;
let databaseUrl: string;
let savedEnv: NodeJS.ProcessEnv;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'worldview-registry-'));
	databaseUrl = `file:${join(dir, 'test.db')}`;
	const db = openDb(databaseUrl);
	migrate(db, { migrationsFolder: MIGRATIONS });
	db.$client.close();
	// Read lazily by getConfig() on the first job; empty LLM values count as unset.
	savedEnv = { ...process.env };
	Object.assign(process.env, {
		DATABASE_URL: databaseUrl,
		NODE_ENV: 'test',
		OMNI_API_URL: '',
		OMNI_API_KEY: '',
		LLM_BASE_URL: '',
		LLM_API_KEY: ''
	});
});
afterAll(() => {
	process.env = savedEnv;
	rmSync(dir, { recursive: true, force: true });
});

describe('runJobByType', () => {
	it.each([
		['a date on an hourly job', 'ingest', { date: '2026-11-13' }],
		['an impossible date', 'brief_morning', { date: '2026-02-30' }],
		['fixtures outside ingest', 'digest', { fixtures: true }],
		['maxEvents outside digest', 'brief_evening', { maxEvents: 3 }],
		['maxEvents 0', 'digest', { maxEvents: 0 }]
	] as const)('rejects %s with exit code 64', async (_name, type, opts) => {
		expect(await runJobByType(type, opts)).toEqual({
			status: 'usage_error',
			exitCode: 64,
			counters: {}
		});
	});

	it('runs ingest → digest → brief → archive through the composition root', async () => {
		const ingest = await runJobByType('ingest', { fixtures: true, manual: true });
		expect(ingest).toMatchObject({ status: 'succeeded', exitCode: 0 });
		expect(ingest.counters.articles_inserted).toBeGreaterThan(0);
		expect(ingest.runId).toEqual(expect.any(String));

		// LLM not configured: tagging fails, every event goes to review, the run is partial.
		const digest = await runJobByType('digest', { maxEvents: 2 });
		expect(digest).toMatchObject({ status: 'partial', exitCode: 2 });
		expect(digest.counters).toMatchObject({ events_pending_review: 2, llm_requests: 0 });

		const db = openDb(databaseUrl);
		const statuses = db
			.select({ status: events.status, reasons: events.review_reasons })
			.from(events)
			.all();
		db.$client.close();
		expect(statuses.filter((row) => row.status === 'pending_review')).toEqual([
			{ status: 'pending_review', reasons: ['llm_failed'] },
			{ status: 'pending_review', reasons: ['llm_failed'] }
		]);

		// No published event: the brief is a draft and the run partial (exit 2).
		const brief = await runJobByType('brief_morning', { date: '2026-11-13' });
		expect(brief).toMatchObject({ status: 'partial', exitCode: 2, counters: { brief_events: 0 } });
		expect(await runJobByType('brief_morning', { date: '2026-11-13' })).toEqual({
			status: 'skipped',
			exitCode: 0,
			counters: {},
			reason: 'already_done'
		});
		expect(await runJobByType('archive_snapshot', { date: '2026-11-12' })).toMatchObject({
			status: 'partial',
			exitCode: 2
		});
	});

	it.each(['brief_morning', 'brief_evening', 'archive_snapshot'] as const)(
		'refuses %s before its window closes, without claiming the slot',
		async (type) => {
			expect(await runJobByType(type, { date: '2099-01-01' })).toEqual({
				status: 'skipped',
				exitCode: 0,
				counters: {},
				reason: 'window_open'
			});
			const db = openDb(databaseUrl);
			const runs = db.select().from(jobRuns).all();
			db.$client.close();
			expect(runs.some((run) => run.idempotency_key === `${type}:2099-01-01`)).toBe(false);

			// A forced rerun alone (the admin page) still respects the window.
			expect(await runJobByType(type, { date: '2099-01-01', force: true })).toMatchObject({
				reason: 'window_open'
			});
			// The CLI's --force also sets allowOpenWindow: an explicit operator decision.
			let claimedKey: string | null = null;
			const forced = await runJobByType(type, {
				date: '2099-01-01',
				force: true,
				allowOpenWindow: true,
				onClaimed: (run) => (claimedKey = run.idempotency_key)
			});
			expect(forced).toMatchObject({ status: 'partial' });
			expect(claimedKey).toBe(`${type}:2099-01-01`);
		}
	);
});
