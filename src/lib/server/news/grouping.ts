/**
 * Rule-based grouping of articles into event candidates (ARCHITECTURE §9). Pure; no LLM yet.
 *
 * Similarity = title-token Jaccard (best match over the event's titles)
 *            + KEYWORD_WEIGHT × keyword Jaccard (feed categories, event tags, title entities).
 * Title tokens work for both scripts: Latin/digit words become (lightly stemmed) word tokens,
 * Thai runs (no spaces between words) become character trigrams.
 *
 * Verdicts: ≥ join → join; ≥ ambiguous → `ambiguous` (would go to LLM `clustering`; until that
 * exists it becomes a new event, because wrong merges are worse than duplicates); else new event.
 */
import type { IsoUtc } from '#lib/types/domain.js';
import type { EventMatchCandidate } from '#lib/types/news.js';

export interface GroupingConfig {
	joinThreshold: number;
	ambiguousThreshold: number;
	/** An article may join a cluster whose time span, widened by this much, contains it. */
	timeWindowMs: number;
	keywordWeight: number;
}

/** Named, tunable constants (data-scientist may tune them on fixtures). */
export const GROUPING_CONFIG: GroupingConfig = {
	joinThreshold: 0.6,
	ambiguousThreshold: 0.3,
	timeWindowMs: 72 * 60 * 60 * 1000,
	keywordWeight: 0.25
};

export interface GroupableArticle {
	id: string;
	title: string;
	published_at: IsoUtc | null;
	ingested_at: IsoUtc;
	/** Feed categories (raw_metadata.categories). */
	categories: string[];
}

export interface GroupingPlan {
	/** Articles to link to existing events. */
	joins: { event_id: string; article_ids: string[]; confidence: number }[];
	/** New draft events, each with its articles. */
	new_events: { article_ids: string[]; confidence: number }[];
	/** How many articles scored in the ambiguous band (became new events for now). */
	ambiguous_count: number;
}

/**
 * Assigns every article to an existing event or a new cluster. Articles are processed in time
 * order, and new clusters are matchable by later articles in the same batch, so three reports of
 * one story arriving together form one event.
 */
export function planGrouping(
	articles: readonly GroupableArticle[],
	events: readonly EventMatchCandidate[],
	config: GroupingConfig = GROUPING_CONFIG
): GroupingPlan {
	const clusters: Cluster[] = events.map((event) => ({
		event_id: event.event_id,
		titleTokenSets: uniqueTitles([event.title, ...event.article_titles]).map(titleTokens),
		keywords: new Set([
			...event.tags.map(normalizeText),
			...[event.title, ...event.article_titles].flatMap(titleEntities)
		]),
		startMs: Date.parse(event.first_seen_at),
		endMs: Date.parse(event.last_updated_at),
		article_ids: [],
		confidence: 1
	}));
	let ambiguousCount = 0;

	const ordered = [...articles].sort(
		(a, b) => articleTime(a) - articleTime(b) || a.id.localeCompare(b.id)
	);
	for (const article of ordered) {
		const profile = articleProfile(article);
		const best = bestMatch(profile, clusters, config);
		if (best && best.score >= config.joinThreshold) {
			addToCluster(best.cluster, profile, best.score);
			continue;
		}
		if (best && best.score >= config.ambiguousThreshold) ambiguousCount++;
		clusters.push(newCluster(profile));
	}

	const touched = clusters.filter((cluster) => cluster.article_ids.length > 0);
	return {
		joins: touched
			.filter((cluster) => cluster.event_id !== null)
			.map((cluster) => ({
				event_id: cluster.event_id!,
				article_ids: cluster.article_ids,
				confidence: cluster.confidence
			})),
		new_events: touched
			.filter((cluster) => cluster.event_id === null)
			.map((cluster) => ({ article_ids: cluster.article_ids, confidence: cluster.confidence })),
		ambiguous_count: ambiguousCount
	};
}

interface ArticleProfile {
	id: string;
	timeMs: number;
	tokens: Set<string>;
	keywords: Set<string>;
}

interface Cluster {
	/** null = a new cluster created in this batch. */
	event_id: string | null;
	titleTokenSets: Set<string>[];
	keywords: Set<string>;
	startMs: number;
	endMs: number;
	/** Articles from this batch assigned to the cluster. */
	article_ids: string[];
	/** Lowest join score among the assigned articles (1 for the article that started it). */
	confidence: number;
}

/** The highest-scoring cluster whose time window contains the article, or null. */
function bestMatch(
	profile: ArticleProfile,
	clusters: Cluster[],
	config: GroupingConfig
): { cluster: Cluster; score: number } | null {
	let best: { cluster: Cluster; score: number } | null = null;
	for (const cluster of clusters) {
		const inWindow =
			profile.timeMs >= cluster.startMs - config.timeWindowMs &&
			profile.timeMs <= cluster.endMs + config.timeWindowMs;
		if (!inWindow) continue;

		const titleScore = Math.max(
			0,
			...cluster.titleTokenSets.map((tokens) => jaccard(profile.tokens, tokens))
		);
		const score = combineScores(titleScore, jaccard(profile.keywords, cluster.keywords), config);
		if (!best || score > best.score) best = { cluster, score };
	}
	return best;
}

function combineScores(titleScore: number, keywordScore: number, config: GroupingConfig): number {
	return Math.min(1, titleScore + config.keywordWeight * keywordScore);
}

function articleProfile(article: GroupableArticle): ArticleProfile {
	return {
		id: article.id,
		timeMs: articleTime(article),
		tokens: titleTokens(article.title),
		keywords: new Set([...article.categories.map(normalizeText), ...titleEntities(article.title)])
	};
}

function articleTime(article: GroupableArticle): number {
	return Date.parse(article.published_at ?? article.ingested_at);
}

function newCluster(profile: ArticleProfile): Cluster {
	return {
		event_id: null,
		titleTokenSets: [profile.tokens],
		keywords: new Set(profile.keywords),
		startMs: profile.timeMs,
		endMs: profile.timeMs,
		article_ids: [profile.id],
		confidence: 1
	};
}

function addToCluster(cluster: Cluster, profile: ArticleProfile, score: number): void {
	cluster.titleTokenSets.push(profile.tokens);
	for (const keyword of profile.keywords) cluster.keywords.add(keyword);
	cluster.startMs = Math.min(cluster.startMs, profile.timeMs);
	cluster.endMs = Math.max(cluster.endMs, profile.timeMs);
	cluster.article_ids.push(profile.id);
	cluster.confidence = Math.min(cluster.confidence, Math.round(score * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const THAI_CHAR = /[฀-๿]/;
const ENGLISH_STOPWORDS = new Set(
	'a an and are as at be by for from has have in into is it its of on or over says said than that the their this to was were will with after amid new'.split(
		' '
	)
);

/** Title tokens: Thai runs → character trigrams; other words → lower-cased, lightly stemmed words. */
export function titleTokens(title: string): Set<string> {
	const tokens = new Set<string>();
	for (const word of normalizeText(title).split(' ')) {
		if (!word) continue;
		if (THAI_CHAR.test(word)) {
			for (const gram of characterTrigrams(word)) tokens.add(gram);
			continue;
		}
		if (ENGLISH_STOPWORDS.has(word)) continue;
		tokens.add(stem(word));
	}
	return tokens;
}

/** Capitalized Latin words (names, places, acronyms) after the first word of the title. */
function titleEntities(title: string): string[] {
	const words = title
		.normalize('NFKC')
		.split(/[^\p{L}\p{M}\p{N}]+/u)
		.filter(Boolean);
	return words
		.slice(1)
		.filter((word) => /^\p{Lu}/u.test(word) && !ENGLISH_STOPWORDS.has(word.toLowerCase()))
		.map((word) => stem(word.toLowerCase()));
}

/** NFKC, lower-case, keep letters/marks/digits (Thai vowels and tone marks are marks), collapse spaces. */
function normalizeText(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
		.trim();
}

function characterTrigrams(word: string): string[] {
	const chars = Array.from(word);
	if (chars.length < 3) return [word];
	const grams: string[] = [];
	for (let index = 0; index + 3 <= chars.length; index++)
		grams.push(chars.slice(index, index + 3).join(''));
	return grams;
}

/** Strips one common English inflection so "approves"/"approved"/"approve" share a token. */
function stem(word: string): string {
	if (word.length < 5 || !/^[a-z]+$/.test(word)) return word;
	for (const suffix of ['ing', 'ed', 'es', 's']) {
		if (word.endsWith(suffix) && word.length - suffix.length >= 4)
			return word.slice(0, -suffix.length);
	}
	return word;
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const token of a) if (b.has(token)) shared++;
	return shared / (a.size + b.size - shared);
}

function uniqueTitles(titles: string[]): string[] {
	return [...new Set(titles.map((title) => title.trim()).filter(Boolean))];
}
