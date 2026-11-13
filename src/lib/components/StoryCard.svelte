<script lang="ts" module>
	import type { Component } from 'svelte';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Globe from '@lucide/svelte/icons/globe';
	import Users from '@lucide/svelte/icons/users';
	import Zap from '@lucide/svelte/icons/zap';
	import type { CategorySlug } from '#lib/types/domain.js';

	export const CATEGORY_ICON: Record<CategorySlug, Component> = {
		geopolitics: Globe,
		economy: ChartColumn,
		technology: Cpu,
		energy: Zap,
		society: Users
	};
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import EventLabels from '#lib/components/EventLabels.svelte';
	import {
		categoryLabel,
		formatThaiDate,
		formatThaiDateTimeShort,
		formatThaiTime,
		regionsLabel,
		UNKNOWN_OCCURRED_AT
	} from '#lib/components/format.js';
	import type { EventSummary } from '#lib/types/views.js';

	let { event }: { event: EventSummary } = $props();

	const Icon = $derived(CATEGORY_ICON[event.category]);
	const regions = $derived(regionsLabel(event.regions));
</script>

<a
	href={resolve('/events/[id]', { id: event.id })}
	class="flex w-full items-start gap-[11px] rounded-2xl border bg-card p-3.5 text-foreground transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-primary/35 sm:gap-4 sm:p-[19px]"
	data-testid="story-card"
	data-category={event.category}
>
	<span
		class="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-primary sm:size-[46px]"
		aria-hidden="true"
	>
		<Icon class="size-5 sm:size-[22px]" strokeWidth={1.7} />
	</span>
	<div class="min-w-0 flex-1">
		<span class="block text-meta font-bold text-primary">
			{categoryLabel(event.category)}
			<span class="font-normal text-faint">{regions ? `· ${regions}` : ''}</span>
		</span>
		<h3 class="my-2 text-[15px] leading-[1.55] font-semibold">{event.title_th}</h3>
		<p class="mb-2 text-xs leading-[1.8] text-muted-foreground">{event.summary_th}</p>
		<span class="mb-2 block text-meta text-faint">
			{formatThaiDate(event.event_date)} ·
			{event.occurred_at
				? `เกิดเหตุ ${formatThaiDateTimeShort(event.occurred_at)}`
				: UNKNOWN_OCCURRED_AT} · อัปเดต {formatThaiTime(event.last_updated_at)} · อ่านสรุปเพิ่มเติม ↗
		</span>
		<EventLabels
			isDemo={event.is_demo}
			sourceCount={event.source_count}
			credibilityLevel={event.credibility_level}
		/>
	</div>
</a>
