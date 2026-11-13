/**
 * Live smoke test of the real LLM endpoint (optional, manual):
 *
 *   npx tsx --env-file=<path to .env> scripts/llm-smoke.ts
 *
 * Sends ONE short fictional English snippet through `summary` (LLM_MODEL_SUMMARY) and `tagging`
 * (LLM_MODEL_TAGGING), plus one `tagging` call on the first exact id in LLM_OMIT_TEMPERATURE_FOR
 * to prove the temperature key is omitted. No retries and no fallback; a temporary database with
 * LLM_DAILY_MAX_REQUESTS = 6 hard-caps the run at 6 requests (each call may use one repair turn).
 *
 * Prints only: task, model, ok / error kind, latency, tokens and schema pass. Never prints env
 * values other than model ids, nor prompts or responses.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getConfig } from '#lib/server/config.js';
import { openDb } from '#lib/server/db/client.js';
import { createLlmCallRepository } from '#lib/server/db/repositories/llm-calls.js';
import { llmCalls } from '#lib/server/db/schema.js';
import { createLlmProviderFromConfig, type LlmConfig } from '#lib/server/llm/index.js';
import type { ArticleRefInput, LlmTask, SummaryInput } from '#lib/types/llm.js';

const MAX_REQUESTS = 6;

const ARTICLE: ArticleRefInput = {
	ref: 'a1',
	source_name: 'Smoke Test Wire (fictional)',
	title: 'Fictional port of Vela reopens after Storm Lira',
	excerpt:
		'Officials in the fictional island nation of Moravia said on Tuesday that the Port of Vela had reopened after Storm Lira. The port authority said damage was minor; a dockworkers union disputed that.',
	published_at: '2026-11-13T01:00:00.000Z',
	language: 'en'
};

const SUMMARY_INPUT: SummaryInput = {
	articles: [ARTICLE],
	extraction: {
		facts: [{ text: 'The Port of Vela reopened after Storm Lira.', evidence: ['a1'] }],
		claims: [
			{ claimant: 'Port authority', claim: 'Damage was minor.', evidence: ['a1'] },
			{ claimant: 'Dockworkers union', claim: 'Disputed that damage was minor.', evidence: ['a1'] }
		],
		occurred_at: null,
		countries: [],
		sensitive: false,
		open_questions: ['Extent of the damage.']
	},
	previous: null
};

const config = getConfig();
const tempDir = mkdtempSync(join(tmpdir(), 'worldview-llm-smoke-'));
const db = openDb(`file:${join(tempDir, 'smoke.db')}`);

try {
	migrate(db, { migrationsFolder: resolve('migrations') });
	const calls = createLlmCallRepository(db);
	const smokeConfig: LlmConfig = {
		...config.llm,
		maxRetries: 0,
		dailyMaxRequests: MAX_REQUESTS,
		models: { ...config.llm.models, fallback: undefined, fallbackSecondary: undefined }
	};
	const providerFor = (models: Partial<LlmConfig['models']>) =>
		createLlmProviderFromConfig(
			{ ...smokeConfig, models: { ...smokeConfig.models, ...models } },
			calls,
			{
				log: () => {}
			}
		);

	console.log(
		'task      model                       result               latency  tokens(in/out)  schema  calls'
	);

	await report('summary', smokeConfig.models.summary, () =>
		providerFor({}).run('summary', SUMMARY_INPUT)
	);
	await report('tagging', smokeConfig.models.tagging, () =>
		providerFor({}).run('tagging', { articles: [ARTICLE] })
	);

	const noTemperatureModel = smokeConfig.omitTemperatureFor.find((entry) => !entry.endsWith('*'));
	if (noTemperatureModel) {
		await report('tagging', noTemperatureModel, () =>
			providerFor({ tagging: noTemperatureModel }).run('tagging', { articles: [ARTICLE] })
		);
	} else {
		console.log('(skipped temperature-omission call: LLM_OMIT_TEMPERATURE_FOR has no exact id)');
	}

	const totalRequests = db.select().from(llmCalls).all().length;
	console.log(`total network requests: ${totalRequests} (cap ${MAX_REQUESTS})`);

	async function report(
		task: LlmTask,
		model: string | undefined,
		run: () => Promise<
			| { ok: true; meta: { latency_ms: number; tokens_in: number; tokens_out: number } }
			| { ok: false; error: { kind: string } }
		>
	) {
		const before = db.select().from(llmCalls).all().length;
		const startedAt = performance.now();
		const result = await run();
		const latency = Math.round(performance.now() - startedAt);
		const rows = db.select().from(llmCalls).all().slice(before);
		const tokensIn = rows.reduce((sum, row) => sum + row.tokens_in, 0);
		const tokensOut = rows.reduce((sum, row) => sum + row.tokens_out, 0);
		const outcome = result.ok ? 'ok' : `error:${result.error.kind}`;
		const schema = result.ok ? 'pass' : result.error.kind === 'invalid_output' ? 'fail' : 'n/a';
		const attempts = rows.map((row) => row.error_kind ?? 'ok').join(',') || '-';

		console.log(
			[
				task.padEnd(9),
				(model ?? '(unset)').padEnd(27),
				outcome.padEnd(20),
				`${latency}ms`.padEnd(8),
				`${tokensIn}/${tokensOut}`.padEnd(15),
				schema.padEnd(7),
				attempts
			].join(' ')
		);
	}
} finally {
	db.$client.close();
	rmSync(tempDir, { recursive: true, force: true });
}
