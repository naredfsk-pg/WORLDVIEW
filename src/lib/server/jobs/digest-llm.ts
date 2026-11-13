/**
 * How the digest steps call the LLM: every call carries the job's run id and abort signal, and
 * its outcome is folded into the job counters. Failures stay values (`ok: false`); callers turn
 * them into gate decisions.
 */
import type { JobContext, JobCounters } from '#lib/types/jobs.js';
import type {
	ArticleRefInput,
	LlmInput,
	LlmOutput,
	LLMProvider,
	LlmResult,
	LlmTask
} from '#lib/types/llm.js';
import type { ArticleWithSource } from '#lib/types/news.js';

export type RunTask = <T extends LlmTask>(
	task: T,
	input: LlmInput<T>
) => Promise<LlmResult<LlmOutput<T>>>;

/** Counts cache hits and failed task runs; network requests and tokens come from `llm_calls`. */
export function createRunTask(
	provider: LLMProvider,
	ctx: Pick<JobContext, 'run' | 'signal' | 'logger'>,
	counters: Required<Pick<JobCounters, 'llm_cache_hits' | 'llm_failures'>>
): RunTask {
	return async (task, input) => {
		const result = await provider.run(task, input, { job_run_id: ctx.run.id, signal: ctx.signal });
		if (!result.ok) {
			counters.llm_failures++;
			ctx.logger.warn('llm task failed', { task, kind: result.error.kind });
		} else if (result.meta.cached) {
			counters.llm_cache_hits++;
		}
		return result;
	};
}

/** Untrusted article metadata for an LLM input, under a per-call ref ("a1"). Never the URL. */
export function toArticleRef(article: ArticleWithSource, ref: string): ArticleRefInput {
	return {
		ref,
		source_name: article.publisher_name,
		title: article.title,
		excerpt: article.excerpt,
		published_at: article.published_at,
		language: article.language
	};
}
