/**
 * Content fingerprint (ARCHITECTURE §9):
 * `sha256hex(norm(title) + '\n' + (excerpt ? norm(excerpt) : 'publisher:' + norm(publisher_name)))`.
 * Without an excerpt the publisher is hashed in, so identical generic titles from different
 * outlets do not collide.
 */
import { createHash } from 'node:crypto';

export function computeContentHash(input: {
	title: string;
	excerpt: string | null;
	publisher_name: string;
}): string {
	const second = input.excerpt
		? normalizeForFingerprint(input.excerpt)
		: `publisher:${normalizeForFingerprint(input.publisher_name)}`;
	return createHash('sha256')
		.update(`${normalizeForFingerprint(input.title)}\n${second}`, 'utf8')
		.digest('hex');
}

/**
 * NFKC, lower-case, keep only letters, combining marks and digits, collapse whitespace.
 * `\p{M}` is kept on purpose: Thai vowel and tone marks are combining marks (Mn), and dropping
 * them would merge different Thai words (refines the contract's `\p{L}\p{N}`).
 */
export function normalizeForFingerprint(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
		.trim();
}
