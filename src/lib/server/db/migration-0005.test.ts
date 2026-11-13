/**
 * Migration 0005 on a database that already holds rows (production upgrade path): the job_runs and
 * admin_actions rebuilds keep every row, the `llm_calls.job_run_id` links survive the job_runs
 * drop (foreign keys stay ON inside the migrator's transaction), `events` gains the credibility
 * columns without losing its FTS triggers, and the new CHECKs hold.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './client';

const MIGRATIONS = fileURLToPath(new URL('../../../../migrations', import.meta.url));

let workDir: string;
let db: Db;

afterEach(() => {
	db?.$client.close();
	rmSync(workDir, { recursive: true, force: true });
});

/** The migrations folder as it was before 0005 (journal trimmed, 0005 removed). */
function migrationsBefore0005(): string {
	const folder = join(workDir, 'migrations-0004');
	cpSync(MIGRATIONS, folder, { recursive: true });
	rmSync(join(folder, '0005_credibility_and_reevaluate.sql'));
	rmSync(join(folder, 'meta', '0005_snapshot.json'));
	const journalPath = join(folder, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
	journal.entries = journal.entries.filter((entry) => !entry.tag.startsWith('0005'));
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

function seedRows(sqlite: Db['$client']) {
	sqlite
		.prepare(
			`INSERT INTO job_runs (id, job_type, idempotency_key, scheduled_for, trigger, attempts, started_at, finished_at, status, counters, error)
			 VALUES ('run-1', 'digest', 'digest:2026-11-13T06', '2026-11-12T23:00:00.000Z', 'cron', 1, '2026-11-12T23:00:01.000Z', '2026-11-12T23:05:00.000Z', 'succeeded', '{"events_published":2}', NULL)`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO llm_calls (id, created_at, task, model, prompt_version, cache_key, status, error_kind, tokens_in, tokens_out, latency_ms, output_json, job_run_id)
			 VALUES ('call-1', '2026-11-12T23:01:00.000Z', 'summary', 'cc/model', 'summary@4', 'key-1', 'ok', NULL, 100, 50, 900, '{}', 'run-1'),
			        ('call-2', '2026-11-12T23:02:00.000Z', 'summary', 'cc/model', 'summary@4', 'key-2', 'ok', NULL, 100, 50, 900, '{}', NULL)`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO admin_actions (id, created_at, action, actor, target, reason)
			 VALUES ('act-1', '2026-11-13T01:00:00.000Z', 'rerun_digest', 'editor@example.com', 'digest:2026-11-13T08#2', 'manual check')`
		)
		.run();
	sqlite
		.prepare(
			`INSERT INTO events (id, status, review_reasons, title_th, summary_th, what_happened_th, why_it_matters_th, background_th, uncertain_th, claims, category, regions, countries, tags, signals, occurred_at, first_seen_at, event_date, last_updated_at, published_at, summarized_at, source_count, is_demo, created_at, updated_at)
			 VALUES ('evt-1', 'pending_review', '["sensitive_single_source"]', 'น้ำท่วมภาคใต้', 'สรุป', 'เกิดขึ้น', 'สำคัญ', NULL, NULL, '[]', 'society', '["asia"]', '[]', '[]', '{"impact_breadth":1,"thailand_relevance":1,"sensitive":true}', NULL, '2026-11-13T00:00:00.000Z', '2026-11-13', '2026-11-13T00:00:00.000Z', NULL, '2026-11-13T00:10:00.000Z', 1, 0, '2026-11-13T00:00:00.000Z', '2026-11-13T00:10:00.000Z')`
		)
		.run();
}

describe('migration 0005 (credibility + reevaluate_pending)', () => {
	it('upgrades a populated 0004 database without losing rows or links', () => {
		workDir = mkdtempSync(join(tmpdir(), 'worldview-migration-'));
		db = openDb(`file:${join(workDir, 'upgrade.db')}`);
		migrate(db, { migrationsFolder: migrationsBefore0005() });
		const sqlite = db.$client;
		seedRows(sqlite);

		migrate(db, { migrationsFolder: MIGRATIONS });

		expect(sqlite.prepare('SELECT id, counters FROM job_runs').all()).toEqual([
			{ id: 'run-1', counters: '{"events_published":2}' }
		]);
		expect(sqlite.prepare('SELECT id, job_run_id FROM llm_calls ORDER BY id').all()).toEqual([
			{ id: 'call-1', job_run_id: 'run-1' },
			{ id: 'call-2', job_run_id: null }
		]);
		expect(sqlite.prepare('SELECT id, action FROM admin_actions').all()).toEqual([
			{ id: 'act-1', action: 'rerun_digest' }
		]);
		expect(
			sqlite.prepare('SELECT credibility_level, credibility_reason_th, title_th FROM events').get()
		).toEqual({ credibility_level: 'none', credibility_reason_th: null, title_th: 'น้ำท่วมภาคใต้' });
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);
		expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
		// No helper table left behind.
		expect(
			sqlite.prepare("SELECT name FROM sqlite_temp_master WHERE name LIKE '__llm%'").all()
		).toEqual([]);

		// The FTS triggers of 0001 still fire.
		sqlite.prepare("UPDATE events SET title_th = 'ไฟป่าภาคเหนือ' WHERE id = 'evt-1'").run();
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM events_fts WHERE events_fts MATCH 'ไฟป่า'").get()
		).toEqual({ n: 1 });

		// The new values are accepted, anything else is refused.
		sqlite
			.prepare(
				`INSERT INTO job_runs (id, job_type, idempotency_key, scheduled_for, trigger, attempts, started_at, status, counters)
				 VALUES ('run-2', 'reevaluate_pending', 'reevaluate_pending:2026-11-13T20', '2026-11-13T13:00:00.000Z', 'manual', 1, '2026-11-13T13:00:01.000Z', 'running', '{}')`
			)
			.run();
		sqlite
			.prepare(
				`INSERT INTO admin_actions (id, created_at, action, actor, target, reason)
				 VALUES ('act-2', '2026-11-13T13:00:00.000Z', 'rerun_reevaluate_pending', 'editor@example.com', 'x#1', 'policy')`
			)
			.run();
		sqlite.prepare("UPDATE events SET credibility_level = 'disputed' WHERE id = 'evt-1'").run();
		expect(() =>
			sqlite.prepare("UPDATE events SET credibility_level = 'fake' WHERE id = 'evt-1'").run()
		).toThrow(/CHECK constraint failed/);
		// The job_run link of LLM calls still works as a foreign key.
		expect(() =>
			sqlite.prepare("UPDATE llm_calls SET job_run_id = 'missing' WHERE id = 'call-2'").run()
		).toThrow(/FOREIGN KEY/);
	});

	it('restores the links of 20k LLM calls in linear time (start-up migrate, busy_timeout 5 s)', () => {
		workDir = mkdtempSync(join(tmpdir(), 'worldview-migration-'));
		db = openDb(`file:${join(workDir, 'large.db')}`);
		migrate(db, { migrationsFolder: migrationsBefore0005() });
		const sqlite = db.$client;
		const run = sqlite.prepare(
			`INSERT INTO job_runs (id, job_type, idempotency_key, scheduled_for, trigger, attempts, started_at, status, counters)
			 VALUES (?, 'digest', ?, '2026-11-12T23:00:00.000Z', 'cron', 1, '2026-11-12T23:00:01.000Z', 'succeeded', '{}')`
		);
		const call = sqlite.prepare(
			`INSERT INTO llm_calls (id, created_at, task, model, prompt_version, cache_key, status, tokens_in, tokens_out, latency_ms, job_run_id)
			 VALUES (?, '2026-11-12T23:01:00.000Z', 'summary', 'cc/model', 'summary@4', ?, 'ok', 1, 1, 1, ?)`
		);
		sqlite.transaction(() => {
			for (let r = 0; r < 200; r++) run.run(`run-${r}`, `digest:${r}`);
			for (let c = 0; c < 20_000; c++) call.run(`call-${c}`, `key-${c}`, `run-${c % 200}`);
		})();

		const started = performance.now();
		migrate(db, { migrationsFolder: MIGRATIONS });
		const elapsedMs = performance.now() - started;

		expect(
			sqlite.prepare('SELECT count(*) AS n FROM llm_calls WHERE job_run_id IS NOT NULL').get()
		).toEqual({ n: 20_000 });
		expect(sqlite.prepare("SELECT job_run_id FROM llm_calls WHERE id = 'call-401'").get()).toEqual({
			job_run_id: 'run-1'
		});
		expect(
			sqlite
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'llm_calls_job_run_id_idx'"
				)
				.all()
		).toHaveLength(1);
		// Was about 9 s with the correlated restore; linear is well under a second here.
		expect(elapsedMs).toBeLessThan(2500);
	});
});
