/** `LlmCallRepository`: response cache, daily-cap usage, and monitoring rows (one per network call). */
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { LlmUsage } from '../../../types/llm';
import type { LlmCallRepository } from '../../../types/repositories';
import type { Db } from '../client';
import { llmCalls } from '../schema';

export function createLlmCallRepository(db: Db): LlmCallRepository {
	return {
		async findCachedOutput(cacheKey) {
			const row = db
				.select({ output_json: llmCalls.output_json })
				.from(llmCalls)
				.where(and(eq(llmCalls.cache_key, cacheKey), eq(llmCalls.status, 'ok')))
				.orderBy(desc(llmCalls.created_at))
				.limit(1)
				.get();
			return row?.output_json ?? null;
		},

		async record(call) {
			db.insert(llmCalls)
				.values({ ...call, id: randomUUID() })
				.run();
		},

		async usageSince(since) {
			return usageWhere(db, gte(llmCalls.created_at, since));
		},

		async usageForJobRun(jobRunId) {
			return usageWhere(db, eq(llmCalls.job_run_id, jobRunId));
		}
	};
}

/** Cache hits are never recorded here, so every row is a network call (ok or error). */
function usageWhere(db: Db, condition: SQL): LlmUsage {
	const row = db
		.select({
			requests: count(),
			tokens: sql<number>`coalesce(sum(${llmCalls.tokens_in} + ${llmCalls.tokens_out}), 0)`
		})
		.from(llmCalls)
		.where(condition)
		.get();
	return { requests: row?.requests ?? 0, tokens: Number(row?.tokens ?? 0) };
}
