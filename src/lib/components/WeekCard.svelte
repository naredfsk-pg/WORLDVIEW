<script lang="ts">
	import { resolve } from '$app/paths';
	import type { AcademyWeek } from '#lib/types/views.js';

	interface Props {
		week: AcademyWeek;
		completedCount: number;
		selected: boolean;
	}

	let { week, completedCount, selected }: Props = $props();
</script>

<a
	href={resolve(`/academy?week=${week.week}`)}
	aria-current={selected ? 'true' : undefined}
	data-sveltekit-noscroll
	class={[
		'flex min-h-[144px] flex-col gap-[13px] rounded-2xl border p-3.5 text-foreground transition-[border-color] duration-150 hover:border-primary/35 sm:min-h-[153px] sm:p-[18px]',
		selected ? 'border-primary bg-accent-subtle' : 'bg-card'
	]}
	data-testid="week-card"
>
	<span class="text-[10px] font-bold tracking-[0.08em] text-primary">WEEK 0{week.week}</span>
	<span class="text-sm leading-[1.55] font-bold">{week.title_th}</span>
	<span class="mt-auto text-meta text-muted-foreground">
		{completedCount} / {week.lessons.length} บทเรียนเสร็จแล้ว
	</span>
</a>
