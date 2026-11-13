/** Cache key = sha256 of canonical JSON { task, model, prompt_version, input } (ARCHITECTURE §10). */
import { createHash } from 'node:crypto';
import type { LlmTask } from '../../types/llm';

export interface CacheKeyParts {
	task: LlmTask;
	model: string;
	prompt_version: string;
	input: unknown;
}

export function computeCacheKey(parts: CacheKeyParts): string {
	return createHash('sha256').update(canonicalJson(parts)).digest('hex');
}

/** `JSON.stringify` with object keys sorted recursively, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (typeof value !== 'object' || value === null) return value;

	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.sort()
			.filter((key) => record[key] !== undefined)
			.map((key) => [key, sortKeys(record[key])])
	);
}
