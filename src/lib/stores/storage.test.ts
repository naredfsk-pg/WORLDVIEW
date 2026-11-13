import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	PROGRESS_KEY,
	readProgress,
	readStorage,
	readTheme,
	THEME_KEY,
	writeProgress,
	writeStorage
} from './storage';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value)
	};
}

const throwingStorage = {
	getItem: () => {
		throw new Error('SecurityError');
	},
	setItem: () => {
		throw new Error('QuotaExceededError');
	}
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('storage helpers', () => {
	it('reads and writes through localStorage', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		expect(writeStorage('k', 'v')).toBe(true);
		expect(readStorage('k')).toBe('v');
	});

	it('never throws when storage is missing or blocked', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(readStorage(THEME_KEY)).toBeNull();
		expect(writeStorage(THEME_KEY, 'dark')).toBe(false);

		vi.stubGlobal('localStorage', throwingStorage);
		expect(readStorage(THEME_KEY)).toBeNull();
		expect(writeStorage(THEME_KEY, 'dark')).toBe(false);
		expect(readProgress()).toEqual([]);
	});

	it('accepts only light/dark as a theme', () => {
		vi.stubGlobal('localStorage', memoryStorage({ [THEME_KEY]: 'dark' }));
		expect(readTheme()).toBe('dark');
		vi.stubGlobal('localStorage', memoryStorage({ [THEME_KEY]: 'sepia' }));
		expect(readTheme()).toBeNull();
	});

	it('round-trips progress and ignores malformed values', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		writeProgress(['w1-d01', 'w1-d02']);
		expect(readProgress()).toEqual(['w1-d01', 'w1-d02']);

		vi.stubGlobal('localStorage', memoryStorage({ [PROGRESS_KEY]: '{"not":"an array"}' }));
		expect(readProgress()).toEqual([]);
		vi.stubGlobal('localStorage', memoryStorage({ [PROGRESS_KEY]: 'not json' }));
		expect(readProgress()).toEqual([]);
		vi.stubGlobal('localStorage', memoryStorage({ [PROGRESS_KEY]: '["w1-d01",1,"w1-d01"]' }));
		expect(readProgress()).toEqual(['w1-d01']);
	});
});
