import { afterEach, describe, expect, it, vi } from 'vitest';
import { academyProgress } from './progress.svelte';
import { PROGRESS_KEY } from './storage';

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value)
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	academyProgress.completed = [];
	academyProgress.saveFailed = false;
});

describe('academyProgress.toggle', () => {
	it('saves the new state', () => {
		const storage = memoryStorage();
		vi.stubGlobal('localStorage', storage);
		academyProgress.toggle('w1-d01');
		expect(academyProgress.has('w1-d01')).toBe(true);
		expect(academyProgress.saveFailed).toBe(false);
		expect(storage.getItem(PROGRESS_KEY)).toBe('["w1-d01"]');
	});

	it('keeps the old state and flags the failure when storage refuses the write', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		});
		academyProgress.toggle('w1-d01');
		expect(academyProgress.has('w1-d01')).toBe(false);
		expect(academyProgress.count).toBe(0);
		expect(academyProgress.saveFailed).toBe(true);
	});
});
