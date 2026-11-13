<script lang="ts">
	import { resolve } from '$app/paths';
	import Check from '@lucide/svelte/icons/check';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import LessonArticle from '#lib/components/LessonArticle.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import StoryCard from '#lib/components/StoryCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { academyProgress } from '#lib/stores/progress.svelte.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const completed = $derived(academyProgress.has(data.lesson.id));
</script>

<SeoHead title="วันที่ {data.lesson.day}: {data.lesson.title}" description={data.lesson.summary} />

<nav aria-label="เส้นทาง" class="mb-4 text-xs">
	<a
		href={resolve(`/academy?week=${data.week.week}`)}
		class="inline-flex min-h-9 items-center text-primary hover:underline"
	>
		← สัปดาห์ที่ {data.week.week}: {data.week.title_th}
	</a>
</nav>

<LessonArticle lesson={data.lesson} week={data.week}>
	<section class="mt-10" aria-labelledby="related-events">
		<h2 id="related-events" class="mb-3 text-[19px] font-bold">เหตุการณ์ปัจจุบันที่เกี่ยวข้อง</h2>
		{#if data.related_events.length === 0}
			<EmptyState message="ยังไม่มีข่าวที่เชื่อมโยงกับบทเรียนนี้" />
		{:else}
			<div class="grid gap-2.5">
				{#each data.related_events as event (event.id)}
					<StoryCard {event} />
				{/each}
			</div>
		{/if}
	</section>

	<div class="mt-10 rounded-[17px] border bg-card p-5">
		<p class="mb-3 text-[13px] text-muted-foreground">
			{completed
				? 'คุณบันทึกว่าอ่านบทเรียนนี้แล้ว (เก็บไว้ในเบราว์เซอร์นี้)'
				: 'อ่านจบแล้ว? บันทึกความคืบหน้าไว้ในเบราว์เซอร์นี้'}
		</p>
		<Button
			variant={completed ? 'outline' : 'default'}
			class="min-h-11 w-full rounded-[11px] text-sm font-bold sm:w-auto sm:px-6"
			aria-pressed={completed}
			data-testid="mark-complete"
			onclick={() => academyProgress.toggle(data.lesson.id)}
		>
			{#if completed}
				<Check aria-hidden="true" /> เรียนจบแล้ว · กดเพื่อยกเลิก
			{:else}
				ทำเครื่องหมายว่าอ่านแล้ว
			{/if}
		</Button>
		{#if academyProgress.saveFailed}
			<p role="alert" class="mt-3 mb-0 text-xs text-gold" data-testid="progress-save-failed">
				บันทึกความคืบหน้าไม่ได้ — เบราว์เซอร์นี้ไม่อนุญาตให้เก็บข้อมูล (เช่น โหมดส่วนตัว)
			</p>
		{/if}
	</div>

	<nav aria-label="บทเรียนก่อนหน้าและถัดไป" class="mt-8 grid gap-2.5 sm:grid-cols-2">
		{#if data.prev}
			<a
				href={resolve('/academy/week/[week]/day/[day]', {
					week: String(data.prev.week),
					day: String(data.prev.day)
				})}
				class="rounded-[13px] border bg-card px-4 py-3 hover:border-primary/35"
			>
				<span class="block text-[11px] text-muted-foreground">← บทก่อนหน้า · วันที่ {data.prev.day}</span
				>
				<span class="block text-[13px] font-bold">{data.prev.title}</span>
			</a>
		{/if}
		{#if data.next}
			<a
				href={resolve('/academy/week/[week]/day/[day]', {
					week: String(data.next.week),
					day: String(data.next.day)
				})}
				class="rounded-[13px] border bg-card px-4 py-3 text-right hover:border-primary/35 sm:col-start-2"
			>
				<span class="block text-[11px] text-muted-foreground">บทถัดไป · วันที่ {data.next.day} →</span>
				<span class="block text-[13px] font-bold">{data.next.title}</span>
			</a>
		{/if}
	</nav>
</LessonArticle>
