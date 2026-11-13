<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FilterChips from '#lib/components/FilterChips.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import StoryCard from '#lib/components/StoryCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		EDITION_LABEL_TH,
		formatThaiDate,
		formatThaiDateTimeShort,
		parseCategory,
		TIMEZONE_LABEL
	} from '#lib/components/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const category = $derived(parseCategory(page.url.searchParams.get('category')));
	const events = $derived(
		data.brief.events.filter((event) => !category || event.category === category)
	);
	const longDate = $derived(formatThaiDate(data.date, 'long'));
</script>

<SeoHead
	title="สรุปข่าว {longDate}"
	description="สรุปข่าวโลก{EDITION_LABEL_TH[
		data.brief.edition
	]}ประจำวันที่ {longDate} พร้อมบริบทและแหล่งข่าวอ้างอิง"
/>

<PageIntro
	eyebrow="DAILY BRIEF · {data.date}"
	title="สรุปข่าว"
	accent={longDate}
	description="เผยแพร่ {formatThaiDateTimeShort(data.brief.published_at)} · {TIMEZONE_LABEL}"
/>

<div class="flex flex-wrap items-center justify-between gap-3">
	<nav aria-label="รอบของสรุปข่าว" class="flex flex-wrap gap-2">
		{#each data.editions_available as edition (edition)}
			{@const current = edition === data.brief.edition}
			<a
				href={resolve(`/brief/[date]?edition=${edition}`, { date: data.date })}
				aria-current={current ? 'page' : undefined}
				class={[
					'inline-flex min-h-11 items-center rounded-full border px-4 text-xs',
					current
						? 'border-accent-subtle bg-accent-subtle font-bold text-primary'
						: 'bg-card text-muted-foreground hover:border-primary'
				]}
			>
				{EDITION_LABEL_TH[edition]}
			</a>
		{/each}
	</nav>
	<nav aria-label="วันก่อนหน้าและวันถัดไป" class="flex gap-2">
		{#if data.prev_date}
			<Button
				href={resolve('/brief/[date]', { date: data.prev_date })}
				variant="outline"
				class="min-h-11 bg-card px-3 text-xs"
			>
				← {formatThaiDate(data.prev_date)}
			</Button>
		{/if}
		{#if data.next_date}
			<Button
				href={resolve('/brief/[date]', { date: data.next_date })}
				variant="outline"
				class="min-h-11 bg-card px-3 text-xs"
			>
				{formatThaiDate(data.next_date)} →
			</Button>
		{/if}
	</nav>
</div>

<FilterChips
	selected={category}
	action="/brief/{data.date}"
	keep={{ edition: page.url.searchParams.get('edition') }}
/>

<section aria-labelledby="brief-stories">
	<!-- Story cards are <h3>; this keeps the outline h1 → h2 → h3 (BUG-QA-008). -->
	<h2 id="brief-stories" class="sr-only">ข่าวในสรุปฉบับนี้</h2>
	{#if events.length === 0}
		<EmptyState message="ไม่มีข่าวในหมวดนี้ในสรุปข่าวฉบับนี้" />
	{:else}
		<div class="grid max-w-[900px] gap-2.5">
			{#each events as event (event.id)}
				<StoryCard {event} />
			{/each}
		</div>
	{/if}
</section>
