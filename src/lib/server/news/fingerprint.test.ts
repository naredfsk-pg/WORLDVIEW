import { describe, expect, it } from 'vitest';
import { computeContentHash, normalizeForFingerprint } from './fingerprint';

describe('computeContentHash', () => {
	const base = {
		title: 'Ceasefire talks resume',
		excerpt: 'Delegations met on Monday.',
		publisher_name: 'Wire A'
	};

	it('is a stable sha256 hex digest', () => {
		const hash = computeContentHash(base);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(computeContentHash({ ...base })).toBe(hash);
		// Pinned so an accidental change to the normalization is caught (existing rows would stop deduping).
		// sha256('ceasefire talks resume\ndelegations met on monday')
		expect(hash).toBe('531c3e1463c9d152606004fbc2703efcd01bbdc5e95d6c0bd02debb469ea02e1');
	});

	it('ignores case, punctuation, whitespace and NFKC-equivalent forms', () => {
		const noisy = {
			...base,
			title: '  CEASEFIRE   talks — resume!  ',
			excerpt: 'Delegations met, on Monday…'
		};
		expect(computeContentHash(noisy)).toBe(computeContentHash(base));
		expect(computeContentHash({ ...base, title: 'Ｃｅａｓｅｆｉｒｅ talks resume' })).toBe(
			computeContentHash(base)
		);
	});

	it('uses the publisher instead of a missing excerpt, so generic titles from different outlets differ', () => {
		const a = computeContentHash({
			title: 'Live updates',
			excerpt: null,
			publisher_name: 'Wire A'
		});
		const b = computeContentHash({
			title: 'Live updates',
			excerpt: null,
			publisher_name: 'Wire B'
		});
		expect(a).not.toBe(b);
		// With an excerpt the publisher is not part of the hash (syndicated copies collide on purpose).
		expect(computeContentHash({ ...base, publisher_name: 'Other' })).toBe(computeContentHash(base));
	});

	it('changes when the content changes', () => {
		expect(computeContentHash({ ...base, title: 'Ceasefire talks collapse' })).not.toBe(
			computeContentHash(base)
		);
	});
});

describe('normalizeForFingerprint', () => {
	it('keeps Thai vowel and tone marks (combining marks), so different Thai words stay different', () => {
		expect(normalizeForFingerprint('ไก่')).toBe('ไก่');
		expect(normalizeForFingerprint('ไก่')).not.toBe(normalizeForFingerprint('ไก'));
		expect(normalizeForFingerprint('ข่าว, ด่วน!')).toBe('ข่าว ด่วน');
	});
});
