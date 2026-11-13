/**
 * Academy progress (completed lesson ids) kept in localStorage under `worldview:academy-progress`.
 * The server always renders "no progress"; `load()` runs once in the browser after hydration
 * (AppShell), so SSR and the first client render match.
 */
import { readProgress, writeProgress } from './storage';

class AcademyProgress {
	completed = $state<string[]>([]);
	loaded = $state(false);

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

	toggle(lessonId: string): void {
		this.completed = this.has(lessonId)
			? this.completed.filter((id) => id !== lessonId)
			: [...this.completed, lessonId];
		writeProgress(this.completed);
	}
}

export const academyProgress = new AcademyProgress();
