/**
 * Rule-based grouping of articles into event candidates (ARCHITECTURE §9). Pure; no LLM yet.
 * Product rule: a wrong merge is worse than a duplicate, so every signal here errs towards "new".
 *
 * score = mean title-token Jaccard against the cluster's article titles (not the best single
 *         title, so a cluster cannot drift one similar headline at a time)
 *       + entityWeight × Jaccard of named entities.
 * Conflict guard: when both sides name entities but share none (Japan vs Chile), or both name
 * event types but share none (flood vs heatwave), the score is capped just below the join
 * threshold, so the pair is at most "ambiguous".
 * Feed categories are not used: one feed tags every item "World" or "Business".
 *
 * Title tokens work for both scripts: Latin words become lightly stemmed word tokens, Thai runs
 * (no spaces between words) become character trigrams, and number-only tokens are dropped.
 *
 * Verdicts: ≥ join → join; ≥ ambiguous → a new event for now, which digest later checks with the
 * LLM `clustering` task (`bestEventMatch` recomputes the score); else new event.
 */
import type { IsoUtc } from '#lib/types/domain.js';
import type { EventMatchCandidate } from '#lib/types/news.js';
import { EVENT_TYPES, PLACES } from './grouping-vocabulary.js';

export interface GroupingConfig {
	joinThreshold: number;
	ambiguousThreshold: number;
	/** An article may join a cluster whose time span, widened by this much, contains it. */
	timeWindowMs: number;
	/** Weight of the named-entity Jaccard added to the title score. */
	entityWeight: number;
	/** How far below `joinThreshold` a conflicting pair is capped. */
	conflictMargin: number;
}

/** Named, tunable constants (data-scientist may tune them on fixtures). */
export const GROUPING_CONFIG: GroupingConfig = {
	joinThreshold: 0.6,
	ambiguousThreshold: 0.3,
	timeWindowMs: 72 * 60 * 60 * 1000,
	entityWeight: 0.15,
	conflictMargin: 0.01
};

export interface GroupableArticle {
	id: string;
	title: string;
	published_at: IsoUtc | null;
	ingested_at: IsoUtc;
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
	const clusters = events.map(clusterFromEvent);
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

/**
 * The best-scoring event for any of `articles` (e.g. the articles of one draft event), using the
 * same score and time window as `planGrouping`. Digest uses it to find the ambiguous pairs that
 * ingest turned into separate events. Null when no event is in the time window.
 */
export function bestEventMatch(
	articles: readonly GroupableArticle[],
	events: readonly EventMatchCandidate[],
	config: GroupingConfig = GROUPING_CONFIG
): { event_id: string; score: number } | null {
	const clusters = events.map(clusterFromEvent);
	let best: { event_id: string; score: number } | null = null;
	for (const article of articles) {
		const match = bestMatch(articleProfile(article), clusters, config);
		if (match && (!best || match.score > best.score)) {
			best = { event_id: match.cluster.event_id!, score: match.score };
		}
	}
	return best;
}

interface ArticleProfile {
	id: string;
	timeMs: number;
	tokens: Set<string>;
	entities: Set<string>;
	eventTypes: Set<string>;
}

interface Cluster {
	/** null = a new cluster created in this batch. */
	event_id: string | null;
	/** One token set per article title. */
	titleTokenSets: Set<string>[];
	entities: Set<string>;
	eventTypes: Set<string>;
	startMs: number;
	endMs: number;
	/** Articles from this batch assigned to the cluster. */
	article_ids: string[];
	/** Lowest join score among the assigned articles (1 for the article that started it). */
	confidence: number;
}

function clusterFromEvent(event: EventMatchCandidate): Cluster {
	// Article titles are the evidence; `title` (maybe a Thai summary title) is the fallback.
	const titles = uniqueTitles(
		event.article_titles.length > 0 ? event.article_titles : [event.title]
	);
	return {
		event_id: event.event_id,
		titleTokenSets: titles.map(titleTokens),
		entities: new Set(titles.flatMap((title) => [...titleEntities(title)])),
		eventTypes: new Set(titles.flatMap((title) => [...eventTypesOf(title)])),
		startMs: Date.parse(event.first_seen_at),
		endMs: Date.parse(event.last_updated_at),
		article_ids: [],
		confidence: 1
	};
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

		const clusterScore = scoreAgainstCluster(profile, cluster, config);
		if (!best || clusterScore > best.score) best = { cluster, score: clusterScore };
	}
	return best;
}

function scoreAgainstCluster(
	profile: ArticleProfile,
	cluster: Cluster,
	config: GroupingConfig
): number {
	const titleScores = cluster.titleTokenSets.map((tokens) => jaccard(profile.tokens, tokens));
	const meanTitleScore = titleScores.reduce((sum, value) => sum + value, 0) / titleScores.length;
	const entityScore = jaccard(profile.entities, cluster.entities);
	const score = Math.min(1, meanTitleScore + config.entityWeight * entityScore);

	const conflicts =
		disjointWhenBothPresent(profile.entities, cluster.entities) ||
		disjointWhenBothPresent(profile.eventTypes, cluster.eventTypes);
	return conflicts ? Math.min(score, config.joinThreshold - config.conflictMargin) : score;
}

function disjointWhenBothPresent(a: Set<string>, b: Set<string>): boolean {
	if (a.size === 0 || b.size === 0) return false;
	for (const value of a) if (b.has(value)) return false;
	return true;
}

function articleProfile(article: GroupableArticle): ArticleProfile {
	return {
		id: article.id,
		timeMs: articleTime(article),
		tokens: titleTokens(article.title),
		entities: titleEntities(article.title),
		eventTypes: eventTypesOf(article.title)
	};
}

function articleTime(article: GroupableArticle): number {
	return Date.parse(article.published_at ?? article.ingested_at);
}

function newCluster(profile: ArticleProfile): Cluster {
	return {
		event_id: null,
		titleTokenSets: [profile.tokens],
		entities: new Set(profile.entities),
		eventTypes: new Set(profile.eventTypes),
		startMs: profile.timeMs,
		endMs: profile.timeMs,
		article_ids: [profile.id],
		confidence: 1
	};
}

function addToCluster(cluster: Cluster, profile: ArticleProfile, joinScore: number): void {
	cluster.titleTokenSets.push(profile.tokens);
	for (const entity of profile.entities) cluster.entities.add(entity);
	for (const eventType of profile.eventTypes) cluster.eventTypes.add(eventType);
	cluster.startMs = Math.min(cluster.startMs, profile.timeMs);
	cluster.endMs = Math.max(cluster.endMs, profile.timeMs);
	cluster.article_ids.push(profile.id);
	cluster.confidence = Math.min(cluster.confidence, Math.round(joinScore * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Tokens, entities, event types
// ---------------------------------------------------------------------------

const THAI_CHAR = /[฀-๿]/;
const NUMBER_ONLY = /^\p{N}+$/u;
const ENGLISH_STOPWORDS = new Set(
	'a an and are as at be by for from has have in into is it its of off on or over says said than that the their this to was were will with after amid new'.split(
		' '
	)
);
/**
 * From this share of capitalized (non-stopword) words a title is in Title Case, so capitals carry
 * no signal. High on purpose: short sentence-case headlines are often mostly names.
 */
const TITLE_CASE_RATIO = 0.9;
/** Above this share of all-caps words a title is shouting, so acronyms carry no signal. */
const ALL_CAPS_RATIO = 0.6;

/** Title tokens: Thai runs → character trigrams; other words → lower-cased, lightly stemmed words. */
export function titleTokens(title: string): Set<string> {
	const tokens = new Set<string>();
	for (const word of normalizeText(title).split(' ')) {
		if (!word || NUMBER_ONLY.test(word)) continue;
		if (THAI_CHAR.test(word)) {
			for (const gram of characterTrigrams(word)) tokens.add(gram);
			continue;
		}
		if (ENGLISH_STOPWORDS.has(word)) continue;
		tokens.add(stem(word));
	}
	return tokens;
}

/**
 * Named entities of a title: known places (English or Thai), acronyms (UN, ASEAN), and, in
 * sentence-case titles, capitalized words after the first one (proper nouns).
 */
export function titleEntities(title: string): Set<string> {
	const entities = new Set(matchVocabulary(title, PLACES));
	const words = title
		.normalize('NFKC')
		.split(/[^\p{L}\p{M}\p{N}]+/u)
		.filter((word) => /^[A-Za-z]+$/.test(word) && !ENGLISH_STOPWORDS.has(word.toLowerCase()));
	if (words.length === 0) return entities;

	const shareOf = (pattern: RegExp) =>
		words.filter((word) => pattern.test(word)).length / words.length;
	const isAllCaps = shareOf(/^[A-Z]+$/) > ALL_CAPS_RATIO;
	const isTitleCase = shareOf(/^[A-Z]/) >= TITLE_CASE_RATIO;
	for (const [index, word] of words.entries()) {
		const isAcronym = !isAllCaps && /^[A-Z]{2,6}$/.test(word);
		const isProperNoun = !isTitleCase && index > 0 && /^[A-Z][a-z]/.test(word);
		if (isAcronym || isProperNoun) entities.add(word.toLowerCase());
	}
	return entities;
}

/** Canonical event types named in a title (flood, heatwave, …). */
export function eventTypesOf(title: string): Set<string> {
	return new Set(matchVocabulary(title, EVENT_TYPES));
}

/**
 * Canonical ids (first element) of the entries whose canonical name or any alias occurs:
 * whole words for English, substrings for Thai.
 */
function matchVocabulary(title: string, vocabulary: readonly (readonly string[])[]): string[] {
	const normalized = normalizeText(title);
	const padded = ` ${normalized} `;
	return vocabulary
		.filter((names) =>
			names.some((alias) =>
				THAI_CHAR.test(alias) ? normalized.includes(alias) : padded.includes(` ${alias} `)
			)
		)
		.map(([canonical]) => canonical!);
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
	for (let index = 0; index + 3 <= chars.length; index++) {
		grams.push(chars.slice(index, index + 3).join(''));
	}
	return grams;
}

/** Strips one common English inflection so "approves"/"approved"/"approve" share a token. */
function stem(word: string): string {
	if (word.length < 5 || !/^[a-z]+$/.test(word)) return word;
	for (const suffix of ['ing', 'ed', 'es', 's']) {
		if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
			return word.slice(0, -suffix.length);
		}
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
