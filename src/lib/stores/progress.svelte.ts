/**
 * Academy progress (completed lesson ids) kept in localStorage under `worldview:academy-progress`.
 * The server always renders "no progress"; `load()` runs once in the browser after hydration
 * (AppShell), so SSR and the first client render match.
 */
import { readProgress, writeProgress } from './storage';

class AcademyProgress {
	completed = $state<string[]>([]);
	loaded = $state(false);
	/** True when the last toggle could not be saved (storage blocked or full). */
	saveFailed = $state(false);

	get count(): number {
		return this.completed.length;
	}

	load(): void {
		this.completed = readProgress();
		this.loaded = true;
	}

	has(lessonId: string): boolean {
		return this.completed.includes(lessonId);
	}

	/** Keeps the old state when saving fails, so the UI never looks saved when it is not. */
	toggle(lessonId: string): void {
		const next = this.has(lessonId)
			? this.completed.filter((id) => id !== lessonId)
			: [...this.completed, lessonId];
		this.saveFailed = !writeProgress(next);
		if (this.saveFailed) return;
		this.completed = next;
	}
}

export const academyProgress = new AcademyProgress();
