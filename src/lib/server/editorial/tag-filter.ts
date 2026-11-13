/**
 * Allegation tags (owner policy, Wave 3): an event that reports allegations about a named
 * person's private life, or criminal or espionage allegations, may still auto-publish when it
 * passes the gates, but its public tags never carry the allegation (for example the Nvidia
 * event's `extramarital-affair` and `alleged-spy`). Pure and deterministic: a small curated
 * denylist over the kebab-case parts of each tag. Topic tags such as `semiconductors`,
 * `us-china`, `espionage-law` or `foreign-affairs` are kept.
 */
import type { Tag } from '../../types/domain';

/** Any tag with one of these parts is dropped: it labels an allegation, not a topic. */
const ALLEGATION_PARTS = new Set([
	// allegation markers: `alleged-*`, `*-allegations`, `accused-*`, `*-scandal`, …
	'alleged',
	'allegedly',
	'allegation',
	'allegations',
	'accused',
	'accusation',
	'accusations',
	'suspected',
	'rumor',
	'rumors',
	'rumour',
	'rumours',
	'scandal',
	'scandals',
	'indicted',
	'indictment',
	'charged',
	'charges',
	// a named person's private life (`affairs` stays: `foreign-affairs`)
	'affair',
	'extramarital',
	'adultery',
	'adulterous',
	'infidelity',
	'mistress',
	// sexual misconduct (`sexual-violence` as a topic stays)
	'misconduct',
	'harassment',
	'molestation',
	'rape',
	// corruption allegations against someone (`corruption` as a topic stays)
	'bribery',
	'embezzlement',
	'kickbacks'
]);

/** Dropped only as the last part, where it names a person: `chinese-spy`, not `spy-satellite`. */
const PERSON_LABEL_LAST_PARTS = new Set(['spy', 'spies', 'traitor']);

/** Exact tags whose parts are each neutral on their own. */
const ALLEGATION_TAGS = new Set(['sexual-assault', 'sexual-abuse', 'sex-abuse']);

/** True when the tag labels an allegation rather than a topic. */
export function isAllegationTag(tag: Tag): boolean {
	const normalized = tag.toLowerCase();
	if (ALLEGATION_TAGS.has(normalized)) return true;
	const parts = normalized.split(/[-_\s]+/);
	if (parts.some((part) => ALLEGATION_PARTS.has(part))) return true;
	return PERSON_LABEL_LAST_PARTS.has(parts[parts.length - 1]!);
}

/** The tags without allegation tags, order kept. */
export function filterAllegationTags(tags: readonly Tag[]): Tag[] {
	return tags.filter((tag) => !isAllegationTag(tag));
}
