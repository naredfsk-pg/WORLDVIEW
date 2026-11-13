<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FeaturedStory from '#lib/components/FeaturedStory.svelte';
	import FilterChips from '#lib/components/FilterChips.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import StoryCard from '#lib/components/StoryCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		categoryLabel,
		EDITION_LABEL_TH,
		formatEyebrowDate,
		formatThaiDate,
		formatThaiTime,
		parseCategory,
		TIMEZONE_LABEL
	} from '#lib/components/format.js';
	import { academyProgress } from '#lib/stores/progress.svelte.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const category = $derived(parseCategory(page.url.searchParams.get('category')));
	const events = $derived(
		(data.brief?.events ?? []).filter((event) => !category || event.category === category)
	);
	const [featured, ...rest] = $derived(events);
	const categoryCount = $derived(new Set(data.brief?.events.map((event) => event.category)).size);
	const topTags = $derived.by(() => {
		const tags = data.brief?.events.flatMap((event) => event.tags) ?? [];
		const countOf = (tag: string) => tags.filter((item) => item === tag).length;
		return [...new Set(tags)].sort((a, b) => countOf(b) - countOf(a)).slice(0, 3);
	});
	const nextLesson = $derived(
		data.lessons.find((lesson) => !academyProgress.has(lesson.id)) ?? data.lessons[0]
	);
</script>

<SeoHead
	title="เข้าใจโลกวันนี้"
	description="ข่าวสำคัญประจำวันพร้อมบริบท ที่มาของเหตุการณ์ แหล่งข่าวอ้างอิง และความเชื่อมโยงที่ช่วยให้เข้าใจภาพรวมของโลก"
/>

<PageIntro
	eyebrow={formatEyebrowDate(data.today)}
	title="เข้าใจโลกวันนี้"
	accent="ให้มากกว่าแค่พาดหัว"
	stacked
	description="ข่าวสำคัญพร้อมบริบท ที่มาของเหตุการณ์ และความเชื่อมโยงที่ช่วยให้คุณเข้าใจภาพรวมได้ง่ายขึ้นในทุกวัน"
/>

{#if !data.brief}
	<EmptyState message="ยังไม่มีสรุปข่าวที่เผยแพร่ ระหว่างนี้ลองเริ่มจากบทเรียนพื้นฐาน หรือดูคลังข่าวย้อนหลัง">
		<Button href={resolve('/academy')} class="min-h-11 px-4">เริ่มเรียนรู้โลก</Button>
		<Button href={resolve('/archive')} variant="outline" class="min-h-11 px-4">คลังข่าวย้อนหลัง</Button>
	</EmptyState>
{:else}
	{@const brief = data.brief}
	<div
		class="grid items-start gap-[27px] md:grid-cols-[minmax(0,1fr)_255px] xl:grid-cols-[minmax(0,1fr)_290px]"
	>
		<div class="min-w-0">
			<div
				class="flex items-center justify-between gap-[13px] rounded-2xl border bg-card px-[19px] py-[17px]"
			>
				<div>
					<p class="m-0 text-sm font-semibold">
						Daily Brief · {formatThaiDate(brief.brief_date, 'long')}
					</p>
					<p class="mt-[3px] mb-0 text-xs text-muted-foreground">
						{#if !data.brief_is_today}
							<span class="font-semibold text-gold">ฉบับล่าสุด (ยังไม่มีสรุปของวันนี้)</span> ·
						{/if}
						สรุปข่าว{EDITION_LABEL_TH[brief.edition]} · {TIMEZONE_LABEL}
					</p>
				</div>
				<Button
					href={resolve('/archive')}
					variant="outline"
					class="min-h-11 shrink-0 rounded-[11px] bg-card px-[15px] text-xs font-bold"
				>
					เลือกวันอื่น ↗
				</Button>
			</div>

			<FilterChips selected={category} action="/" />

			{#if featured}
				<FeaturedStory event={featured} />
			{/if}

			<div class="mt-[23px] mb-3.5 flex items-center justify-between gap-2.5">
				<h2 class="m-0 text-lg font-bold tracking-[-0.03em] sm:text-[19px]">
					{category ? `ข่าวหมวด${categoryLabel(category)}` : 'เรื่องสำคัญที่ควรรู้'}
				</h2>
				<span class="text-xs text-muted-foreground">{events.length} เรื่อง</span>
			</div>

			{#if events.length === 0}
				<EmptyState message="ยังไม่มีข่าวในหมวดนี้ในสรุปข่าวฉบับนี้" />
			{:else}
				<div class="grid gap-2.5">
					{#each rest as event (event.id)}
						<StoryCard {event} />
					{/each}
				</div>
			{/if}
		</div>

		<aside class="grid gap-[15px] sm:grid-cols-2 md:grid-cols-1" aria-label="ภาพรวมและบทเรียน">
			<section
				class="rounded-[17px] border bg-card p-[19px] sm:col-span-2 md:col-span-1"
				aria-labelledby="overview-title"
			>
				<h2 id="overview-title" class="mb-[13px] text-base font-bold">ภาพรวมข่าววันนี้</h2>
				<dl class="m-0 text-xs">
					<div class="flex items-center justify-between border-b py-[9px]">
						<dt class="text-muted-foreground">เหตุการณ์สำคัญ</dt>
						<dd class="text-[13px] font-bold">{brief.events.length}</dd>
					</div>
					<div class="flex items-center justify-between border-b py-[9px]">
						<dt class="text-muted-foreground">หมวดหมู่</dt>
						<dd class="text-[13px] font-bold">{categoryCount}</dd>
					</div>
					<div class="flex items-center justify-between py-[9px]">
						<dt class="text-muted-foreground">เผยแพร่ ({TIMEZONE_LABEL})</dt>
						<dd class="text-[13px] font-bold">{formatThaiTime(brief.published_at)}</dd>
					</div>
				</dl>
				{#if topTags.length > 0}
					<ul class="mt-[15px] flex flex-wrap gap-[5px]" aria-label="แท็กยอดนิยม">
						{#each topTags as tag (tag)}
							<li
								class="rounded-full bg-surface-2 px-[9px] py-[5px] text-meta text-muted-foreground"
							>
								#{tag}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if nextLesson}
				<section
					class="flex flex-col gap-[9px] rounded-[15px] border bg-card p-[18px]"
					aria-labelledby="next-lesson-title"
				>
					<p class="m-0 text-[10px] font-bold text-primary">LEARN WITH THE NEWS</p>
					<h2 id="next-lesson-title" class="m-0 text-[15px] font-bold">{nextLesson.title}</h2>
					<p class="m-0 text-xs text-muted-foreground">{nextLesson.summary}</p>
					<a
						href={resolve('/academy/week/[week]/day/[day]', {
							week: String(nextLesson.week),
							day: String(nextLesson.day)
						})}
						class="mt-1 inline-flex min-h-9 items-center self-start text-xs font-bold text-primary hover:underline"
					>
						เปิดบทเรียน →
					</a>
				</section>
			{/if}

			<section
				class="flex flex-col gap-[9px] rounded-[15px] border bg-card p-[18px]"
				aria-labelledby="read-better-title"
			>
				<p class="m-0 text-[10px] font-bold text-primary">READ BETTER</p>
				<h2 id="read-better-title" class="m-0 text-[15px] font-bold">ถาม 3 คำถามก่อนแชร์ข่าว</h2>
				<p class="m-0 text-xs text-muted-foreground">
					เกิดอะไรขึ้น? หลักฐานมาจากไหน? และอะไรยังไม่ชัดเจน?
				</p>
			</section>
		</aside>
	</div>
{/if}
