/** `IngestRepository`: source registry sync, article dedup-insert, source health. */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, notInArray } from 'drizzle-orm';
import type { IngestRepository } from '../../../types/repositories';
import type { InsertArticleResult } from '../../../types/news';
import { isHttpUrl } from '../../../utils/url';
import type { Db } from '../client';
import { articles, sources } from '../schema';

/** Same content_hash within this window counts as a duplicate (ARCHITECTURE §9). */
const CONTENT_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SOURCE_ERROR_LENGTH = 300;

export function createIngestRepository(db: Db): IngestRepository {
	return {
		async syncSources(definitions) {
			db.transaction((tx) => {
				for (const definition of definitions) {
					const registryFields = {
						name: definition.name,
						kind: definition.kind,
						homepage_url: definition.homepage_url,
						feed_url: definition.feed_url,
						license_notes: definition.license_notes,
						allow_excerpt: definition.allow_excerpt,
						is_demo: definition.is_demo,
						enabled: definition.enabled
					};
					tx.insert(sources)
						.values({ id: definition.id, ...registryFields })
						.onConflictDoUpdate({ target: sources.id, set: registryFields })
						.run();
				}
				// Sources removed from the registry are disabled, never deleted (articles reference them).
				const registryIds = definitions.map((definition) => definition.id);
				tx.update(sources)
					.set({ enabled: false })
					.where(registryIds.length > 0 ? notInArray(sources.id, registryIds) : undefined)
					.run();
			});
		},

		async listEnabledSources() {
			return db
				.select()
				.from(sources)
				.where(eq(sources.enabled, true))
				.orderBy(asc(sources.id))
				.all();
		},

		async insertArticleIfNew(article) {
			// Boundary check: stored URLs are cited and rendered as links, so only http(s) is accepted.
			if (!isHttpUrl(article.canonical_url) || !isHttpUrl(article.source_url)) {
				throw new Error('insertArticleIfNew: canonical_url and source_url must be http(s)');
			}
			return db.transaction(
				(tx): InsertArticleResult => {
					const sameUrl = tx
						.select({ id: articles.id })
						.from(articles)
						.where(eq(articles.canonical_url, article.canonical_url))
						.get();
					if (sameUrl) return { outcome: 'duplicate_url', article_id: sameUrl.id };

					const windowStart = new Date(
						Date.parse(article.ingested_at) - CONTENT_DEDUP_WINDOW_MS
					).toISOString();
					const sameContent = tx
						.select({ id: articles.id })
						.from(articles)
						.where(
							and(
								eq(articles.content_hash, article.content_hash),
								gte(articles.ingested_at, windowStart)
							)
						)
						.get();
					if (sameContent) return { outcome: 'duplicate_content', article_id: sameContent.id };

					const id = randomUUID();
					tx.insert(articles)
						.values({ ...article, id, taxonomy: null })
						.run();
					return { outcome: 'inserted', article_id: id };
				},
				{ behavior: 'immediate' }
			);
		},

		async recordSourceFetch(sourceId, result) {
			const set = result.ok
				? { last_success_at: result.at, ...result.validators }
				: { last_error_at: result.at, last_error: result.error.slice(0, MAX_SOURCE_ERROR_LENGTH) };
			db.update(sources).set(set).where(eq(sources.id, sourceId)).run();
		}
	};
}
