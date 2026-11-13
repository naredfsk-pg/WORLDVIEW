<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LessonSummary } from '#lib/types/views.js';

	let { lesson, completed }: { lesson: LessonSummary; completed: boolean } = $props();

	const dayLabel = $derived(String(lesson.day).padStart(2, '0'));
</script>

<a
	href={resolve('/academy/week/[week]/day/[day]', {
		week: String(lesson.week),
		day: String(lesson.day)
	})}
	class="flex w-full items-center gap-[13px] rounded-[13px] border bg-card px-4 py-3.5 text-foreground transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-primary/35"
	data-testid="lesson-card"
	data-completed={completed}
>
	<span
		class={[
			'grid size-[42px] shrink-0 place-items-center rounded-[11px] text-[11px] font-bold',
			completed ? 'bg-accent-subtle text-primary' : 'bg-surface-2 text-muted-foreground'
		]}
	>
		{#if completed}
			<span aria-hidden="true">✓</span><span class="sr-only">เรียนแล้ว · วันที่ {lesson.day}</span>
		{:else}
			DAY {dayLabel}
		{/if}
	</span>
	<span class="min-w-0 flex-1">
		<span class="block text-[13px] leading-[1.5] font-bold">{lesson.title}</span>
		<span class="mt-[3px] block text-meta text-muted-foreground">{lesson.summary}</span>
	</span>
	<span class="text-primary" aria-hidden="true">→</span>
</a>
