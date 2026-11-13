import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaimJobInput } from '../../../types/jobs';
import type { Db } from '../client';
import { openTestDb } from '../test-db';
import { createJobRunRepository } from './job-runs';

let db: Db;
let jobs: ReturnType<typeof createJobRunRepository>;

beforeEach(() => {
	db = openTestDb();
	jobs = createJobRunRepository(db);
});
afterEach(() => db.$client.close());

const input = (overrides: Partial<ClaimJobInput> = {}): ClaimJobInput => ({
	job_type: 'ingest',
	idempotency_key: 'ingest:2026-11-13T06',
	scheduled_for: '2026-11-12T23:00:00.000Z',
	trigger: 'cron',
	force: false,
	now: '2026-11-12T23:00:05.000Z',
	...overrides
});

describe('JobRunRepository.claim', () => {
	it('claims a new key once; a second claim of the same live key reports running', async () => {
		const first = await jobs.claim(input());
		const second = await jobs.claim(input({ now: '2026-11-12T23:10:00.000Z' }));

		expect(first).toMatchObject({ claimed: true, run: { status: 'running', attempts: 1 } });
		expect(second).toMatchObject({ claimed: false, reason: 'running' });
		expect(await jobs.listRecent(10)).toHaveLength(1);
	});

	it('skips a finished slot as already_done unless forced, and force reuses the same row', async () => {
		const first = await jobs.claim(input());
		if (!first.claimed) throw new Error('expected claim');
		await jobs.finish(
			first.run.id,
			{ status: 'succeeded', counters: { articles_inserted: 3 }, error: null },
			'2026-11-12T23:02:00.000Z'
		);

		const again = await jobs.claim(input({ now: '2026-11-12T23:30:00.000Z' }));
		expect(again).toMatchObject({ claimed: false, reason: 'already_done' });

		const forced = await jobs.claim(
			input({ now: '2026-11-12T23:31:00.000Z', force: true, trigger: 'manual' })
		);
		expect(forced).toMatchObject({
			claimed: true,
			run: { id: first.run.id, attempts: 2, status: 'running', trigger: 'manual', counters: {} }
		});
		expect(await jobs.listRecent(10)).toHaveLength(1);
	});

	it('reclaims a failed slot and increments attempts', async () => {
		const first = await jobs.claim(input());
		if (!first.claimed) throw new Error('expected claim');
		await jobs.finish(
			first.run.id,
			{ status: 'failed', counters: {}, error: 'boom' },
			'2026-11-12T23:01:00.000Z'
		);

		const retry = await jobs.claim(input({ now: '2026-11-12T23:05:00.000Z' }));
		expect(retry).toMatchObject({ claimed: true, run: { attempts: 2, error: null } });
	});

	it('treats a running claim older than 30 minutes as dead, but never steals a live one with force', async () => {
		await jobs.claim(input());

		const live = await jobs.claim(input({ now: '2026-11-12T23:29:00.000Z', force: true }));
		expect(live).toMatchObject({ claimed: false, reason: 'running' });

		const stale = await jobs.claim(input({ now: '2026-11-12T23:30:05.000Z' }));
		expect(stale).toMatchObject({ claimed: true, run: { attempts: 2 } });
	});

	it('lastSucceeded returns the latest succeeded run of a type', async () => {
		expect(await jobs.lastSucceeded('ingest')).toBeNull();
		const run = await jobs.claim(input());
		if (!run.claimed) throw new Error('expected claim');
		await jobs.finish(
			run.run.id,
			{ status: 'succeeded', counters: {}, error: null },
			'2026-11-12T23:02:00.000Z'
		);
		expect(await jobs.lastSucceeded('ingest')).toMatchObject({ id: run.run.id });
		expect(await jobs.lastSucceeded('digest')).toBeNull();
	});
});
