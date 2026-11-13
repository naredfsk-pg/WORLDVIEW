/**
 * Timeline entry for a re-summarized published event (`event_updates`, Wave 3). Pure. The text
 * comes from the summary task's `update_th`; the evidence is the newly linked stored articles,
 * never LLM refs. The same checks as the event gates apply: Thai text with no URL (G2/G3) and
 * evidence that resolves to stored, citable articles (G1/G5). Anything else → no entry.
 */
import type { EventUpdate } from '../../types/domain';
import type { ArticleWithSource } from '../../types/news';
import { isHttpUrl } from '../../utils/url';
import { containsUrl, isThaiText } from './text';

export type EventUpdateWrite = Omit<EventUpdate, 'id' | 'event_id' | 'created_at'>;

export interface EventUpdateInput {
	update_th: string | null;
	/** The articles the update is about (newly linked, and seen by the summary call). */
	evidence_article_ids: readonly string[];
	/** The event's stored articles. */
	articles: readonly ArticleWithSource[];
}

export function buildEventUpdate(input: EventUpdateInput): EventUpdateWrite | null {
	const text = input.update_th?.trim() ?? '';
	if (!isThaiText(text) || containsUrl(text)) return null;

	const byId = new Map(input.articles.map((article) => [article.id, article]));
	const evidence: ArticleWithSource[] = [];
	for (const id of new Set(input.evidence_article_ids)) {
		const article = byId.get(id);
		if (!article || !isHttpUrl(article.canonical_url)) return null;
		evidence.push(article);
	}
	if (evidence.length === 0) return null;

	// UTC ISO strings sort lexically, so the string maximum is the newest report.
	const reportedAt = evidence
		.map((article) => article.published_at ?? article.ingested_at)
		.sort()
		.at(-1)!;
	return {
		occurred_at: null,
		reported_at: reportedAt,
		update_text_th: text,
		evidence_refs: evidence.map((article) => ({ article_id: article.id }))
	};
}
