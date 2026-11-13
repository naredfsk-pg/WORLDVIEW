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
		'Alleged-Spy'
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
		'elections'
	])('keeps the topic tag %s', (tag) => {
		expect(isAllegationTag(tag)).toBe(false);
	});
});
