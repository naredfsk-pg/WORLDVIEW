<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AcademyRoadmap from '#lib/components/AcademyRoadmap.svelte';
	import LessonCard from '#lib/components/LessonCard.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import WeekCard from '#lib/components/WeekCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { academyProgress } from '#lib/stores/progress.svelte.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const LESSON_TOTAL = 30;
	const selectedWeek = $derived(
		data.weeks.find((week) => String(week.week) === page.url.searchParams.get('week')) ??
			data.weeks[0]
	);
	const nextLesson = $derived(
		selectedWeek?.lessons.find((lesson) => !academyProgress.has(lesson.id)) ??
			selectedWeek?.lessons[0]
	);
</script>

<SeoHead
	title="เรียนรู้โลก 30 วัน"
	description="หลักสูตร 4 สัปดาห์ 30 บทเรียน ตั้งแต่ประวัติศาสตร์ ภูมิรัฐศาสตร์ เศรษฐกิจ ทรัพยากร ไปจนถึงอนาคตและการคิดวิเคราะห์"
/>

<PageIntro
	eyebrow="WORLD ACADEMY · YOUR FOUNDATION"
	title="เรียนรู้โลก"
	accent="30 วัน"
	description="เริ่มจากประวัติศาสตร์ เศรษฐกิจ ไปจนถึงเหตุการณ์ร่วมสมัย เรียนวันละเรื่อง อ่านซ้ำได้ทุกเมื่อและไม่ต้องรีบ"
/>

<section
	class="mb-[23px] flex flex-col items-start justify-between gap-5 rounded-[20px] border bg-hero p-[22px] sm:flex-row sm:items-center md:px-7 md:py-[25px]"
	aria-labelledby="journey-title"
>
	<div>
		<p class="mb-1.5 text-[10px] font-bold tracking-[0.16em] text-primary">YOUR LEARNING JOURNEY</p>
		<h2 id="journey-title" class="mb-2 text-xl font-bold">ค่อย ๆ เข้าใจโลก ทีละบทเรียน</h2>
		<p class="m-0 text-xs text-muted-foreground">
			ความคืบหน้าถูกบันทึกไว้ในเบราว์เซอร์นี้เท่านั้น ไม่ต้องสมัครสมาชิก
		</p>
	</div>
	<p class="m-0 flex items-baseline gap-[7px]" data-testid="academy-progress">
		<strong class="text-[36px] leading-none tracking-[-0.06em] text-primary md:text-[43px]">
			{academyProgress.count}
		</strong>
		<span class="text-xs text-muted-foreground">/ {LESSON_TOTAL} บทเรียน</span>
	</p>
</section>

<AcademyRoadmap weeks={data.weeks} isCompleted={(id) => academyProgress.has(id)} />

<div class="mt-[23px] mb-3.5 flex items-center justify-between gap-2.5">
	<h2 class="m-0 text-lg font-bold tracking-[-0.03em] sm:text-[19px]">เลือกเส้นทางการเรียนรู้</h2>
	<span class="text-xs text-muted-foreground">4 สัปดาห์ · {LESSON_TOTAL} บทเรียน</span>
</div>

<nav aria-label="สัปดาห์" class="mb-[22px]">
	<ul class="grid grid-cols-2 gap-[9px] sm:gap-3 lg:grid-cols-4">
		{#each data.weeks as week (week.week)}
			<li class="grid">
				<WeekCard
					{week}
					selected={week === selectedWeek}
					completedCount={week.lessons.filter((lesson) => academyProgress.has(lesson.id)).length}
				/>
			</li>
		{/each}
	</ul>
</nav>

{#if selectedWeek}
	<div
		class="grid items-start gap-[21px] md:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_310px]"
	>
		<section aria-labelledby="lesson-list-title">
			<div class="mb-3.5 flex items-center justify-between gap-2.5">
				<h2 id="lesson-list-title" class="m-0 text-lg font-bold tracking-[-0.03em] sm:text-[19px]">
					บทเรียนสัปดาห์ที่ {selectedWeek.week}
				</h2>
				<span class="text-xs text-muted-foreground">{selectedWeek.lessons.length} บทเรียน</span>
			</div>
			<ol class="grid gap-[9px]">
				{#each selectedWeek.lessons as lesson (lesson.id)}
					<li><LessonCard {lesson} completed={academyProgress.has(lesson.id)} /></li>
				{/each}
			</ol>
		</section>

		<aside
			class="rounded-[17px] border bg-card p-[22px] md:sticky md:top-5"
			aria-labelledby="week-detail-title"
		>
			<p class="m-0 text-[10px] font-bold tracking-[0.07em] text-primary">
				WEEK {selectedWeek.week} · DAY {String(selectedWeek.first_day).padStart(2, '0')}–{String(
					selectedWeek.last_day
				).padStart(2, '0')}
			</p>
			<h2 id="week-detail-title" class="my-[11px] text-[19px] font-bold">
				{selectedWeek.title_th}
			</h2>
			<p class="text-[13px] leading-[1.85] text-muted-foreground">
				{selectedWeek.tagline_th} — {selectedWeek.description_th}
			</p>
			{#if nextLesson}
				<p class="mt-[18px] mb-2 text-xs font-bold">บทเรียนถัดไปของคุณ</p>
				<p class="mb-3 text-[13px] text-muted-foreground">
					วันที่ {nextLesson.day}: {nextLesson.title}
				</p>
				<Button
					href={resolve('/academy/week/[week]/day/[day]', {
						week: String(nextLesson.week),
						day: String(nextLesson.day)
					})}
					class="min-h-11 w-full rounded-[11px] text-xs font-bold"
				>
					เริ่มอ่านบทเรียน
				</Button>
			{/if}
		</aside>
	</div>
{/if}
