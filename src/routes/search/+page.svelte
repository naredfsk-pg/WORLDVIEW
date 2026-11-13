<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import LessonCard from '#lib/components/LessonCard.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import StoryCard from '#lib/components/StoryCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { categoryLabel, queryString } from '#lib/components/format.js';
	import { academyProgress } from '#lib/stores/progress.svelte.js';
	import { CATEGORY_SLUGS } from '#lib/types/domain.js';
	import { SEARCH_TOTAL_CAP } from '#lib/types/views.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SCOPE_LABEL = { all: 'ทั้งหมด', events: 'ข่าว', lessons: 'บทเรียน' } as const;

	const query = $derived(data.query);
	const results = $derived(data.results);
	const pageNumber = $derived(query ? query.offset / query.limit + 1 : 1);
	// Totals stop counting past SEARCH_TOTAL_CAP, which is also the deepest result the route
	// serves, so a capped total never offers a page past the last one.
	const hasMore = $derived(
		query !== null &&
			results !== null &&
			Math.min(Math.max(results.events_total, results.lessons_total), SEARCH_TOTAL_CAP) >
				query.offset + query.limit
	);

	function formatTotal(total: number): string {
		return total > SEARCH_TOTAL_CAP ? `${SEARCH_TOTAL_CAP}+` : String(total);
	}

	function pageHref(target: number) {
		const current = Object.fromEntries(page.url.searchParams);
		return resolve(`/search?${queryString({ ...current, page: String(target) })}`);
	}
</script>

<SeoHead
	title={query ? `ค้นหา “${query.q}”` : 'ค้นหาข่าวและบทเรียน'}
	description="ค้นหาเหตุการณ์ที่เผยแพร่แล้วและบทเรียน 30 วันของ Worldview"
	noindex={query !== null}
/>

<PageIntro eyebrow="SEARCH" title="ค้นหา" accent="ข่าวและบทเรียน" />

<form
	method="GET"
	action="/search"
	role="search"
	class="mb-6 grid max-w-[760px] gap-3 rounded-[17px] border bg-card p-4"
>
	<div class="flex gap-2">
		<label for="search-q" class="sr-only">คำค้นหา</label>
		<input
			id="search-q"
			name="q"
			type="search"
			maxlength="100"
			value={query?.q ?? ''}
			placeholder="เช่น เงินเฟ้อ, AI, สงครามเย็น"
			class="min-h-11 min-w-0 flex-1 rounded-[13px] border bg-surface-2 px-[15px] text-foreground placeholder:text-muted-foreground"
		/>
		<Button type="submit" class="min-h-11 rounded-[11px] px-4 font-bold">ค้นหา</Button>
	</div>
	<div class="flex flex-wrap gap-3 text-xs">
		<label class="flex items-center gap-2 text-muted-foreground">
			ค้นใน
			<select
				name="scope"
				class="min-h-11 rounded-[11px] border bg-card px-2 text-foreground"
				value={query?.scope ?? 'all'}
			>
				{#each Object.entries(SCOPE_LABEL) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="flex items-center gap-2 text-muted-foreground">
			หมวดหมู่
			<select
				name="category"
				class="min-h-11 rounded-[11px] border bg-card px-2 text-foreground"
				value={query?.category ?? ''}
			>
				<option value="">ทุกหมวด</option>
				{#each CATEGORY_SLUGS as slug (slug)}
					<option value={slug}>{categoryLabel(slug)}</option>
				{/each}
			</select>
		</label>
	</div>
</form>

{#if !query || !results}
	<EmptyState message="พิมพ์คำที่ต้องการค้นหา เช่น เงินเฟ้อ, AI, ชิป หรือสงครามเย็น" />
{:else}
	<p class="mb-4 text-xs text-muted-foreground" role="status">
		ผลการค้นหา “{query.q}” · ข่าว {formatTotal(results.events_total)} รายการ · บทเรียน {formatTotal(
			results.lessons_total
		)} บท
	</p>

	{#if results.events_total === 0 && results.lessons_total === 0}
		<EmptyState message="ไม่พบผลลัพธ์ ลองใช้คำอื่นหรือคำที่สั้นลง" />
	{:else if results.events.length === 0 && results.lessons.length === 0}
		<EmptyState message="ไม่มีผลลัพธ์ในหน้านี้ ลองย้อนกลับไปหน้าก่อน" />
	{/if}

	{#if results.events.length > 0}
		<section class="mb-8 max-w-[900px]" aria-labelledby="event-results">
			<h2 id="event-results" class="mb-3 text-lg font-bold">ข่าวและเหตุการณ์</h2>
			<div class="grid gap-2.5">
				{#each results.events as event (event.id)}
					<StoryCard {event} />
				{/each}
			</div>
		</section>
	{/if}

	{#if results.lessons.length > 0}
		<section class="mb-8 max-w-[900px]" aria-labelledby="lesson-results">
			<h2 id="lesson-results" class="mb-3 text-lg font-bold">บทเรียน</h2>
			<div class="grid gap-[9px]">
				{#each results.lessons as lesson (lesson.id)}
					<LessonCard {lesson} completed={academyProgress.has(lesson.id)} />
				{/each}
			</div>
		</section>
	{/if}

	{#if pageNumber > 1 || hasMore}
		<nav aria-label="หน้าผลการค้นหา" class="flex gap-2">
			{#if pageNumber > 1}
				<Button href={pageHref(pageNumber - 1)} variant="outline" class="min-h-11 bg-card px-4">
					← หน้าก่อน
				</Button>
			{/if}
			{#if hasMore}
				<Button href={pageHref(pageNumber + 1)} variant="outline" class="min-h-11 bg-card px-4">
					หน้าถัดไป →
				</Button>
			{/if}
		</nav>
	{/if}
{/if}
