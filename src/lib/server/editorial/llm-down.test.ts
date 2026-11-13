/**
 * PRD §11 acceptance #9: with the LLM provider down, no exception escapes, new and draft events
 * go to `pending_review [llm_failed]`, and published events keep their previous text.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventStatus } from '../../types/domain';
import type { LLMProvider } from '../../types/llm';
import type { Db } from '../db/client';
import { createLlmCallRepository } from '../db/repositories/llm-calls';
import { openTestDb } from '../db/test-db';
import { createLlmProvider, createLlmProviderFromConfig, createMockTransport } from '../llm';
import { parseConfig } from '../config';
import { LINKED_ARTICLES, REF_TO_ARTICLE_ID, SUMMARY_INPUT } from '../llm/test-fixtures';
import { evaluateEventForPublish } from './event-gate';

let db: Db;
beforeEach(() => {
	db = openTestDb();
});
afterEach(() => db.$client.close());

/** What the digest does per event: extraction → summary → gates. */
async function digestEvent(provider: LLMProvider, currentStatus: EventStatus) {
	const extraction = await provider.run('extraction', { articles: SUMMARY_INPUT.articles });
	const summary = extraction.ok
		? await provider.run('summary', { ...SUMMARY_INPUT, extraction: extraction.data })
		: null;
	const failed = !extraction.ok ? extraction : summary && !summary.ok ? summary : null;

	return evaluateEventForPublish({
		mode: 'auto',
		articles: LINKED_ARTICLES,
		ref_to_article_id: REF_TO_ARTICLE_ID,
		extraction: extraction.ok ? extraction.data : null,
		summary: summary?.ok ? summary.data : null,
		signals: null,
		category: 'economy',
		current_status: currentStatus,
		llm_error_kind: failed ? failed.error.kind : null
	});
}

function timingOutProvider() {
	const config = parseConfig({ LLM_MODEL_ID: 'cc/model-a', LLM_MODEL_FALLBACK: 'cx/model-b' }).llm;
	return createLlmProvider({
		transport: createMockTransport([{ fail: 'timeout' }]),
		calls: createLlmCallRepository(db),
		settings: config,
		sleep: async () => {},
		log: () => {}
	});
}

describe('LLM provider down (acceptance #9)', () => {
	it('times out on every model without throwing; drafts go to pending_review [llm_failed]', async () => {
		const provider = timingOutProvider();

		await expect(
			provider.run('extraction', { articles: SUMMARY_INPUT.articles })
		).resolves.toMatchObject({
			ok: false,
			error: { kind: 'timeout', model: 'cx/model-b' }
		});
		for (const status of ['draft', 'pending_review'] as const) {
			expect(await digestEvent(provider, status)).toEqual({
				status: 'pending_review',
				review_reasons: ['llm_failed']
			});
		}
	});

	it('keeps a published event as it is', async () => {
		expect(await digestEvent(timingOutProvider(), 'published')).toEqual({
			status: 'keep_published',
			review_reasons: ['llm_failed']
		});
	});

	it('treats an unconfigured endpoint the same way (LLM env unset)', async () => {
		const provider = createLlmProviderFromConfig(parseConfig({}).llm, createLlmCallRepository(db));

		expect(await provider.run('summary', SUMMARY_INPUT)).toMatchObject({
			ok: false,
			error: { kind: 'not_configured' }
		});
		expect(await digestEvent(provider, 'draft')).toEqual({
			status: 'pending_review',
			review_reasons: ['llm_failed']
		});
	});
});
