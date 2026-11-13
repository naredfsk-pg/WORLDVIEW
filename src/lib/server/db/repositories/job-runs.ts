/**
 * `JobRunRepository`: one row per logical slot (UNIQUE idempotency_key). `claim` runs in an
 * IMMEDIATE transaction, so two processes racing for the same key serialize on the write lock
 * and the second one sees the first one's row (ARCHITECTURE §8).
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { ClaimJobResult } from '../../../types/jobs';
import type { JobRunRepository } from '../../../types/repositories';
import type { Db } from '../client';
import { jobRuns } from '../schema';

/** A `running` claim older than this is treated as a dead process and may be reclaimed. */
export const STALE_RUNNING_CLAIM_MS = 30 * 60 * 1000;

export function createJobRunRepository(db: Db): JobRunRepository {
	return {
		async claim(input) {
			return db.transaction(
				(tx): ClaimJobResult => {
					const existing = tx
						.select()
						.from(jobRuns)
						.where(eq(jobRuns.idempotency_key, input.idempotency_key))
						.get();

					if (!existing) {
						const run = tx
							.insert(jobRuns)
							.values({
								id: randomUUID(),
								job_type: input.job_type,
								idempotency_key: input.idempotency_key,
								scheduled_for: input.scheduled_for,
								trigger: input.trigger,
								attempts: 1,
								started_at: input.now,
								finished_at: null,
								status: 'running',
								counters: {},
								error: null
							})
							.returning()
							.get();
						return { claimed: true, run };
					}

					if (existing.status === 'running') {
						const startedMs = Date.parse(existing.started_at);
						const isLive = Date.parse(input.now) - startedMs < STALE_RUNNING_CLAIM_MS;
						// `force` never steals a live claim.
						if (isLive) return { claimed: false, reason: 'running', existing };
					}
					const isDone = existing.status === 'succeeded' || existing.status === 'partial';
					if (isDone && !input.force) return { claimed: false, reason: 'already_done', existing };

					// failed, dead `running`, or a forced rerun of a finished slot.
					const run = tx
						.update(jobRuns)
						.set({
							trigger: input.trigger,
							attempts: existing.attempts + 1,
							started_at: input.now,
							finished_at: null,
							status: 'running',
							counters: {},
							error: null
						})
						.where(eq(jobRuns.id, existing.id))
						.returning()
						.get();
					return { claimed: true, run };
				},
				{ behavior: 'immediate' }
			);
		},

		// CONTRACT-GAP: `finish(runId, …)` carries no claim token (e.g. `attempts`), so a process
		// whose stale claim was reclaimed can still overwrite the newer attempt's outcome.
		async finish(runId, outcome, finishedAt) {
			db.update(jobRuns)
				.set({
					status: outcome.status,
					counters: outcome.counters,
					error: outcome.error,
					finished_at: finishedAt
				})
				.where(eq(jobRuns.id, runId))
				.run();
		},

		async listRecent(limit) {
			return db.select().from(jobRuns).orderBy(desc(jobRuns.started_at)).limit(limit).all();
		},

		async lastSucceeded(jobType) {
			const run = db
				.select()
				.from(jobRuns)
				.where(and(eq(jobRuns.job_type, jobType), eq(jobRuns.status, 'succeeded')))
				.orderBy(desc(jobRuns.finished_at))
				.limit(1)
				.get();
			return run ?? null;
		}
	};
}
