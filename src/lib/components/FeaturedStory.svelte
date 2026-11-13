<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import EventLabels from '#lib/components/EventLabels.svelte';
	import {
		categoryLabel,
		formatThaiTime,
		regionsLabel,
		UNKNOWN_OCCURRED_AT
	} from '#lib/components/format.js';
	import type { EventSummary } from '#lib/types/views.js';

	let { event }: { event: EventSummary } = $props();
</script>

<a
	href={resolve('/events/[id]', { id: event.id })}
	class="relative flex min-h-[286px] w-full overflow-hidden rounded-[20px] border bg-hero text-foreground md:min-h-[282px]"
	data-testid="featured-story"
	data-category={event.category}
>
	<div
		class="relative z-[1] flex w-[91%] flex-col items-start px-[21px] py-[22px] sm:w-[79%] md:w-[75%] md:px-[30px] md:py-7 xl:w-[70%]"
	>
		<span class="text-[10px] font-bold tracking-[0.09em] text-primary uppercase">
			Featured explainer · {categoryLabel(event.category)}
		</span>
		<h2
			class="mt-3 mb-2.5 max-w-[530px] text-[20px] leading-[1.45] font-bold tracking-[-0.03em] sm:text-[21px] md:text-[clamp(21px,2.2vw,28px)]"
		>
			{event.title_th}
		</h2>
		<p class="max-w-[460px] text-xs leading-[1.8] text-muted-foreground sm:text-[13px]">
			{event.summary_th}
		</p>
		<span class="mb-3 block"
			><EventLabels isDemo={event.is_demo} sourceCount={event.source_count} /></span
		>
		<span class="mt-auto flex flex-wrap items-center gap-[9px] text-[11px] text-muted-foreground">
			<span>
				{event.occurred_at ? formatThaiTime(event.occurred_at) : UNKNOWN_OCCURRED_AT}
			</span>
			{#if event.regions.length > 0}
				<span class="text-faint" aria-hidden="true">·</span>
				<span>{regionsLabel(event.regions)}</span>
			{/if}
			<span
				class="ml-2 grid size-[31px] place-items-center rounded-full border border-primary/25 text-primary"
				aria-hidden="true"
			>
				<ArrowRight class="size-4" strokeWidth={1.8} />
			</span>
		</span>
	</div>
	<span
		class="absolute top-[5%] right-[-100px] flex h-[95%] w-[63%] items-center justify-center opacity-[.23] sm:opacity-35 md:right-[-45px] md:w-[42%] md:opacity-85"
		aria-hidden="true"
	>
		<svg viewBox="0 0 300 300" fill="none" class="size-full">
			<circle cx="150" cy="150" r="104" stroke="var(--accent)" stroke-width="1" opacity=".2" />
			<circle cx="150" cy="150" r="86" fill="var(--hero-dark)" />
			<circle cx="150" cy="150" r="84" stroke="var(--accent)" opacity=".32" stroke-width="1.4" />
			<ellipse cx="150" cy="150" rx="35" ry="84" stroke="var(--accent)" opacity=".5" />
			<ellipse cx="150" cy="150" rx="65" ry="84" stroke="var(--accent)" opacity=".28" />
			<path d="M67 150h166M80 112h141M80 188h141" stroke="var(--accent)" opacity=".32" />
			<circle cx="197" cy="91" r="8" fill="var(--accent)" />
			<circle cx="107" cy="178" r="6" fill="var(--accent)" />
			<path d="m197 91-90 87" stroke="var(--accent)" stroke-dasharray="4 6" opacity=".8" />
			<circle
				cx="150"
				cy="150"
				r="128"
				stroke="var(--accent)"
				opacity=".15"
				stroke-dasharray="3 7"
			/>
		</svg>
	</span>
</a>
