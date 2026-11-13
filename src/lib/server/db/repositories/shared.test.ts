import { describe, expect, it } from 'vitest';
import { evidenceUrls } from './shared';

describe('evidenceUrls', () => {
	it('resolves refs to stored URLs, drops unknown refs and removes duplicates in order', () => {
		const urls = new Map([
			['art-1', 'https://example.com/1'],
			['art-2', 'https://example.com/2']
		]);
		const refs = ['art-2', 'art-1', 'art-2', 'missing', 'art-1'].map((article_id) => ({
			article_id
		}));

		expect(evidenceUrls(refs, urls)).toEqual(['https://example.com/2', 'https://example.com/1']);
	});
});
