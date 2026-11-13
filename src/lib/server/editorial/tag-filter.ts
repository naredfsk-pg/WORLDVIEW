/**
 * Allegation tags (owner policy, Wave 3): an event that reports allegations about a named
 * person's private life, or criminal or espionage allegations, may still auto-publish when it
 * passes the gates, but its public tags never carry the allegation (for example the Nvidia
 * event's `extramarital-affair` and `alleged-spy`). Pure and deterministic: a small curated
 * rule set over the kebab-case parts of each tag (`tagSchema` makes every LLM tag kebab-case
 * ASCII). When in doubt a tag is dropped: losing a topic tag only weakens linking, while a kept
 * allegation tag is public.
 */
import type { Tag } from '../../types/domain';

/** A part starting with one of these always labels an allegation (`accuses`, `bribes`, …). */
const ALLEGATION_STEMS = [
	'alleg', // alleged, allegedly, allegation(s)
	'accus', // accuse(s|d), accusing, accusation(s)
	'rumor',
	'rumour',
	'scandal',
	'indict', // indicted, indictment
	'brib', // bribe(s), bribery, bribed
	'kickback',
	'embezzl',
	'extramarital',
	'adulter', // adultery, adulterous
	'infidelit',
	'mistress', // mistress(es)
	'philander',
	'molest',
	'rapist',
	'spying',
	'spied'
];

/** As the last part these name a person: `chinese-spy`, `ex-spy` (`spy-satellite` stays). */
const PERSON_LABELS = new Set(['spy', 'spies', 'traitor', 'traitors', 'suspect', 'suspects']);

/** `spy` / `espionage` next to a case word is about a person: `spy-trial`, `espionage-case`. */
const ESPIONAGE_PARTS = new Set(['spy', 'spies', 'espionage']);
const CASE_PARTS = new Set([
	'case',
	'cases',
	'trial',
	'trials',
	'probe',
	'probes',
	'charge',
	'charges',
	'charged',
	'arrest',
	'arrested'
]);

/** `charge(s)` only in allegation compounds: `fraud-charges` goes, `service-charges` stays. */
const CHARGE_PARTS = new Set(['charge', 'charges', 'charged']);
const CRIME_PARTS = new Set([
	'criminal',
	'fraud',
	'corruption',
	'murder',
	'terror',
	'terrorism',
	'treason',
	'sedition',
	'assault',
	'sexual',
	'sex',
	'drug',
	'drugs',
	'laundering',
	'evasion'
]);

/**
 * Words that label an allegation about someone unless the tag also names a topic around them
 * (`police-misconduct`, `rape-law`, `suspected-cholera`); alone or in other compounds they go.
 */
const QUALIFIED_PARTS = new Set(['misconduct', 'harassment', 'rape', 'rapes', 'suspected']);
const TOPIC_QUALIFIERS = new Set([
	'law',
	'laws',
	'legislation',
	'policy',
	'policies',
	'reform',
	'reforms',
	'bill',
	'rules',
	'prevention',
	'awareness',
	'workplace',
	'police',
	'military',
	'campus',
	'online',
	'institutional',
	'systemic',
	'outbreak',
	'outbreaks',
	'cases',
	'cholera',
	'measles',
	'ebola',
	'mpox'
]);

/** `affair(s)` is a person's private life, except in these public-affairs compounds. */
const AFFAIRS_PREFIXES = [
	'foreign-',
	'public-',
	'veterans-',
	'consumer-',
	'current-',
	'internal-',
	'international-'
];

/** Compounds whose parts are each neutral on their own. */
const ALLEGATION_PAIRS: readonly (readonly [string, readonly string[]])[] = [
	['sexual', ['assault', 'abuse', 'crime', 'crimes']],
	['sex', ['abuse', 'crime', 'crimes', 'tape', 'tapes']]
];

/** True when the tag labels an allegation rather than a topic. */
export function isAllegationTag(tag: Tag): boolean {
	const normalized = tag.trim().toLowerCase();
	const parts = normalized.split('-').filter((part) => part !== '');
	if (parts.length === 0) return false;
	const hasPartIn = (set: ReadonlySet<string>) => parts.some((part) => set.has(part));

	if (parts.some((part) => ALLEGATION_STEMS.some((stem) => part.startsWith(stem)))) return true;
	if (PERSON_LABELS.has(parts[parts.length - 1]!)) return true;
	if (hasPartIn(ESPIONAGE_PARTS) && hasPartIn(CASE_PARTS)) return true;
	if (hasPartIn(CHARGE_PARTS) && hasPartIn(CRIME_PARTS)) return true;
	if (hasPartIn(QUALIFIED_PARTS) && !hasPartIn(TOPIC_QUALIFIERS)) return true;
	if (parts.includes('affair') || parts.includes('affairs')) {
		return !AFFAIRS_PREFIXES.some((prefix) => normalized.startsWith(prefix));
	}
	return ALLEGATION_PAIRS.some(
		([first, seconds]) => parts.includes(first) && seconds.some((second) => parts.includes(second))
	);
}

/** The tags without allegation tags, order kept. */
export function filterAllegationTags(tags: readonly Tag[]): Tag[] {
	return tags.filter((tag) => !isAllegationTag(tag));
}
