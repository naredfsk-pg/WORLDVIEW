import { describe, expect, it } from 'vitest';
import { filterAllegationTags, isAllegationTag } from './tag-filter';

describe('filterAllegationTags (owner policy: no public tags derived from allegations)', () => {
	it('the Nvidia case: drops the allegation tags and keeps the topic tags, in order', () => {
		const tags = [
			'nvidia',
			'extramarital-affair',
			'semiconductors',
			'alleged-spy',
			'us-china',
			'jensen-huang',
			'nvidia-scandal',
			'national-security'
		];
		expect(filterAllegationTags(tags)).toEqual([
			'nvidia',
			'semiconductors',
			'us-china',
			'jensen-huang',
			'national-security'
		]);
	});

	it('leaves a neutral event unchanged', () => {
		const tags = ['nato', 'interest-rates', 'water', 'cop31', 'ukraine-war', 'world-news'];
		expect(filterAllegationTags(tags)).toEqual(tags);
	});

	it.each([
		'alleged-spy',
		'alleged-fraud',
		'spy-allegations',
		'corruption-allegations',
		'accused-of-espionage',
		'suspected-spy',
		'chinese-spy',
		'russian-spies',
		'sex-scandal',
		'cheating-scandal',
		'affair',
		'extramarital-affair',
		'adultery',
		'infidelity',
		'sexual-misconduct',
		'sexual-harassment',
		'sexual-assault',
		'bribery',
		'embezzlement',
		'espionage-charges',
		'fraud-charges',
		'indictment',
		'Alleged-Spy',
		// Review M4: inflections and compounds that slipped through the first version.
		'spying',
		'chinese-spying',
		'spy-case',
		'spy-trial',
		'spy-probe',
		'espionage-case',
		'espionage-probe',
		'ex-spy',
		'love-affairs',
		'secret-affairs',
		'office-affairs',
		'affairs',
		'mistresses',
		'accuse',
		'accuses',
		'accusing',
		'fraud-charge',
		'criminal-charges',
		'bribe',
		'bribes',
		'kickback',
		'kickbacks',
		'rapist',
		'rape',
		'sex-crimes',
		'sexual-abuse',
		'philandering',
		'sex-tape',
		'misconduct',
		'harassment',
		'suspected-fraud',
		'traitor'
	])('drops the allegation tag %s', (tag) => {
		expect(isAllegationTag(tag)).toBe(true);
	});

	it.each([
		'semiconductors',
		'us-china',
		'foreign-affairs',
		'veterans-affairs',
		'espionage-law',
		'cyber-espionage',
		'spy-satellite',
		'spyware',
		'corruption',
		'anti-corruption',
		'sexual-violence',
		'ground-assault',
		'national-security',
		'congress',
		'elections',
		'public-affairs',
		'consumer-affairs',
		'current-affairs',
		'internal-affairs',
		'international-affairs',
		'espionage',
		'spy-balloon',
		'spy-agency',
		'us-spy-agency',
		'chinese-spy-balloon',
		'spy-chief',
		// Review L6: topic compounds of words that otherwise label an allegation.
		'service-charges',
		'bank-charges',
		'charges',
		'charged-particles',
		'ev-charging',
		'chargers',
		'police-misconduct',
		'workplace-harassment',
		'sexual-harassment-law',
		'rape-law',
		'suspected-outbreak',
		'suspected-cholera',
		'tax-fraud',
		'money-laundering',
		'corruption-probe'
	])('keeps the topic tag %s', (tag) => {
		expect(isAllegationTag(tag)).toBe(false);
	});
});
