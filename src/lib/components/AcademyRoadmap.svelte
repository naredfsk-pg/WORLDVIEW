<script lang="ts">
	import { resolve } from '$app/paths';
	import type { AcademyWeek } from '#lib/types/views.js';

	/**
	 * The 30-day path at a glance: one row per week, a numbered stop per day linked to the lesson.
	 * Completed days are filled and get a check badge (not colour alone).
	 */
	let { weeks, isCompleted }: { weeks: AcademyWeek[]; isCompleted: (id: string) => boolean } =
		$props();
</script>

<section class="mb-[23px] rounded-[20px] border bg-card p-4 sm:p-5" aria-labelledby="roadmap-title">
	<h2 id="roadmap-title" class="mb-1 text-lg font-bold tracking-[-0.03em] sm:text-[19px]">
		แผนที่เส้นทาง 30 วัน
	</h2>
	<p class="mb-4 text-meta text-muted-foreground">
		4 สัปดาห์ เรียงจากพื้นฐานไปสู่การคิดวิเคราะห์ กดตัวเลขเพื่อเปิดบทเรียนของวันนั้น
	</p>
	<ol class="grid gap-4">
		{#each weeks as week (week.week)}
			<li class="grid gap-2 md:grid-cols-[minmax(0,13rem)_1fr] md:items-center md:gap-4">
				<p class="m-0">
					<span class="block text-[10px] font-bold tracking-[0.08em] text-primary">
						WEEK 0{week.week}
					</span>
					<span class="block text-sm leading-[1.55] font-bold">{week.title_th}</span>
				</p>
				<ol class="relative flex flex-wrap gap-1.5" aria-label="บทเรียนสัปดาห์ที่ {week.week}">
					{#each week.lessons as lesson (lesson.id)}
						{@const completed = isCompleted(lesson.id)}
						<li class="relative">
							<a
								href={resolve('/academy/week/[week]/day/[day]', {
									week: String(lesson.week),
									day: String(lesson.day)
								})}
								title={lesson.title}
								data-testid="roadmap-day"
								data-completed={completed}
								class={[
									'relative grid size-11 place-items-center rounded-full border-2 text-[13px] font-bold transition-[border-color] duration-150 hover:border-primary',
									completed
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-stroke bg-surface-2 text-foreground'
								]}
							>
								<span aria-hidden="true">{lesson.day}</span>
								{#if completed}
									<span
										aria-hidden="true"
										class="absolute -top-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full border-2 border-card bg-gold-bg text-[10px] text-gold"
									>
										✓
									</span>
								{/if}
								<span class="sr-only">
									วันที่ {lesson.day}: {lesson.title}{completed ? ' (เรียนแล้ว)' : ''}
								</span>
							</a>
						</li>
					{/each}
				</ol>
			</li>
		{/each}
	</ol>
</section>
