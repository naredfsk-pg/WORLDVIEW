/**
 * Browser storage (ARCHITECTURE §15). Every access is wrapped in try/catch: storage can be missing
 * (SSR), disabled (private mode) or full, and the UI must keep working without it.
 */
export const THEME_KEY = 'worldview:theme';
export const PROGRESS_KEY = 'worldview:academy-progress';

export type Theme = 'light' | 'dark';

export function readStorage(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** Returns false when the value could not be saved. */
export function writeStorage(key: string, value: string): boolean {
	try {
		globalThis.localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export function readTheme(): Theme | null {
	const value = readStorage(THEME_KEY);
	return value === 'light' || value === 'dark' ? value : null;
}

/** Completed lesson ids; anything malformed counts as no progress. */
export function readProgress(): string[] {
	const raw = readStorage(PROGRESS_KEY);
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return [...new Set(parsed.filter((id): id is string => typeof id === 'string'))];
	} catch {
		return [];
	}
}

export function writeProgress(ids: readonly string[]): boolean {
	return writeStorage(PROGRESS_KEY, JSON.stringify(ids));
}
