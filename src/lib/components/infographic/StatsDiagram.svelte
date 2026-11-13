<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';

	/** Key numbers as tiles: value + unit, then what it measures. The source is in the figcaption. */
	let { items }: { items: (InfographicNode & { value: string; unit?: string })[] } = $props();
</script>

<ul class="grid gap-2.5 @[22rem]:grid-cols-2 @2xl:grid-cols-3">
	{#each items as item, index (index)}
		<li class="rounded-[13px] border bg-surface-2 p-3.5">
			<p class="m-0 flex flex-wrap items-baseline gap-x-1.5">
				<span class="text-[28px] leading-[1.2] font-bold tracking-[-0.03em] text-primary">
					{item.value}
				</span>
				{#if item.unit}
					<span class="text-sm font-bold text-primary">{item.unit}</span>
				{/if}
			</p>
			<p class="m-0 mt-1 text-[15px] leading-[1.6] font-bold">{item.label}</p>
			{#if item.detail}
				<p class="m-0 mt-0.5 text-sm leading-[1.7] text-muted-foreground">{item.detail}</p>
			{/if}
		</li>
	{/each}
</ul>
