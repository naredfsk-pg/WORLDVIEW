<script lang="ts">
	import { resolve } from '$app/paths';
	import ArchiveCalendar from '#lib/components/ArchiveCalendar.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FilterChips from '#lib/components/FilterChips.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import StoryCard from '#lib/components/StoryCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		EDITION_LABEL_TH,
		formatThaiDate,
		queryString,
		regionsLabel,
		TIMEZONE_LABEL
	} from '#lib/components/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const events = $derived(
		(data.brief?.events ?? []).filter(
			(event) =>
				(!data.category || event.category === data.category) &&
				(!data.region || event.regions.includes(data.region))
		)
	);
</script>

<SeoHead
	title="คลังข่าวย้อนหลัง"
	description="เลือกวันที่และหมวดหมู่เพื่อย้อนดูสรุปข่าวโลกในแต่ละวัน พร้อมบริบทและแหล่งข่าวอ้างอิง"
/>

<PageIntro
	eyebrow="ARCHIVE · GO BACK IN TIME"
	title="ทุกวันมีเรื่องราว"
	accent="ให้ย้อนเข้าใจ"
	description="เลือกวันที่ที่คุณสนใจ แล้วสำรวจว่ามีเหตุการณ์อะไรเกิดขึ้นบ้าง พร้อมหมวดหมู่และบริบทที่เกี่ยวข้อง"
/>

<div class="mb-[15px] flex flex-wrap items-center justify-between gap-3">
	<form method="GET" action="/archive" class="flex flex-wrap items-center gap-[9px]">
		{#if data.category}
			<input type="hidden" name="category" value={data.category} />
		{/if}
		{#if data.region}
			<input type="hidden" name="region" value={data.region} />
		{/if}
		<label for="archive-date" class="text-xs text-muted-foreground">เลือกวันที่</label>
		<input
			id="archive-date"
			type="date"
			name="date"
			required
			value={data.selected_date ?? ''}
			max={data.today}
			onchange={(event) => event.currentTarget.form?.requestSubmit()}
			class="min-h-11 rounded-[11px] border bg-card px-3 text-foreground"
		/>
		<Button type="submit" variant="outline" class="min-h-11 rounded-[11px] bg-card px-3 text-xs">
			ดูข่าว
		</Button>
	</form>
	<Button
		href={resolve(`/archive?${queryString({ category: data.category, region: data.region })}`)}
		variant="outline"
		class="min-h-11 rounded-[11px] bg-card px-[15px] text-xs font-bold"
	>
		กลับไปวันล่าสุด
	</Button>
</div>

<div
	class="grid items-start gap-[23px] md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]"
>
	<ArchiveCalendar
		month={data.month}
		maxMonth={data.max_month}
		selected={data.selected_date}
		available={data.available_dates}
		category={data.category}
		region={data.region}
	/>

	<section class="min-w-0" aria-labelledby="archive-headline" aria-live="polite">
		{#if data.selected_date}
			<h2 id="archive-headline" class="mb-1 text-[17px] font-bold" data-testid="archive-headline">
				ข่าวประจำวันที่ {formatThaiDate(data.selected_date)}
			</h2>
			{#if data.brief}
				<p class="mb-0 text-xs text-muted-foreground">
					สรุปข่าว{EDITION_LABEL_TH[data.brief.edition]} · {TIMEZONE_LABEL} ·
					<a
						href={resolve('/brief/[date]', { date: data.selected_date })}
						class="inline-flex min-h-8 items-center font-bold text-primary hover:underline"
					>
						เปิดหน้าสรุปข่าวเต็ม →
					</a>
				</p>
			{/if}
		{:else}
			<h2 id="archive-headline" class="mb-1 text-[17px] font-bold" data-testid="archive-headline">
				ยังไม่ได้เลือกวันที่
			</h2>
		{/if}

		<FilterChips
			selected={data.category}
			action="/archive"
			keep={{ month: data.month, date: data.selected_date, region: data.region }}
		/>
		{#if data.region}
			<p class="-mt-2 mb-3 text-xs text-muted-foreground">
				ภูมิภาค: {regionsLabel([data.region])} ·
				<a
					href={resolve(
						`/archive?${queryString({ month: data.month, date: data.selected_date, category: data.category })}`
					)}
					class="text-primary underline"
				>
					ล้างตัวกรองภูมิภาค
				</a>
			</p>
		{/if}

		{#if !data.brief}
			<EmptyState
				message={data.selected_date
					? 'ไม่มีสรุปข่าวในวันที่เลือก ลองเลือกวันที่มีจุดสีเขียวในปฏิทิน'
					: 'เดือนนี้ยังไม่มีสรุปข่าว ลองเลือกเดือนอื่นจากปฏิทิน'}
			/>
		{:else if events.length === 0}
			<EmptyState message="ไม่มีข่าวในวันที่และหมวดที่เลือก ลองเลือกหมวด “ทั้งหมด”" />
		{:else}
			<div class="grid gap-2.5" data-testid="archive-results">
				{#each events as event (event.id)}
					<StoryCard {event} />
				{/each}
			</div>
		{/if}
	</section>
</div>
