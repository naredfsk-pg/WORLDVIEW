/**
 * Browser storage (ARCHITECTURE §15). Every access is wrapped in try/catch: storage can be missing
 * (SSR), disabled (private mode) or full, and the UI must keep working without it.
 */
export const THEME_KEY = 'worldview:theme';
export const PROGRESS_KEY = 'worldview:academy-progress';

export type Theme = 'light' | 'dark';

/** Last global day of each week: the locked 7/7/7/9 split (ARCHITECTURE §13). */
const WEEK_LAST_DAY = [7, 14, 21, 30] as const;

/** The 30 lesson ids, "w1-d01" … "w4-d30". Progress may only contain these. */
export const KNOWN_LESSON_IDS: ReadonlySet<string> = new Set(
	Array.from({ length: 30 }, (_, index) => {
		const day = index + 1;
		const week = WEEK_LAST_DAY.findIndex((lastDay) => day <= lastDay) + 1;
		return `w${week}-d${String(day).padStart(2, '0')}`;
	})
);

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

/**
 * Completed lesson ids, limited to known lessons (so the count never exceeds 30); anything
 * malformed counts as no progress.
 */
export function readProgress(): string[] {
	const raw = readStorage(PROGRESS_KEY);
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const ids = parsed.filter(
			(id): id is string => typeof id === 'string' && KNOWN_LESSON_IDS.has(id)
		);
		return [...new Set(ids)];
	} catch {
		return [];
	}
}

export function writeProgress(ids: readonly string[]): boolean {
	return writeStorage(PROGRESS_KEY, JSON.stringify(ids));
}
