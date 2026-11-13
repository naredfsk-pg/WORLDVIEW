<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';

	/** Key numbers as tiles: value + unit, then what it measures. The source is in the figcaption. */
	let { items }: { items: (InfographicNode & { value: string; unit?: string })[] } = $props();

	/** Three columns only when the rows come out even or nearly so (3, 5, 6 tiles; 4 stay 2×2). */
	const threeColumns = $derived(items.length === 3 || items.length >= 5);

	/** Screen readers skip or misread "~", "<" and ">", so the value is also given in words. */
	const SPOKEN_PREFIXES: Record<string, string> = { '~': 'ประมาณ', '<': 'น้อยกว่า', '>': 'มากกว่า' };
	const spokenValue = (value: string) => {
		const word = SPOKEN_PREFIXES[value.charAt(0)];
		return word ? `${word} ${value.slice(1).trim()}` : null;
	};
</script>

<ul class={['grid gap-2.5 @[22rem]:grid-cols-2', threeColumns && '@xl:grid-cols-3']}>
	{#each items as item, index (index)}
		{@const spoken = spokenValue(item.value)}
		<li class="rounded-[13px] border bg-surface-2 p-3.5">
			<p class="m-0 flex flex-wrap items-baseline gap-x-1.5">
				<span
					class="text-[28px] leading-[1.2] font-bold tracking-[-0.03em] text-primary"
					aria-hidden={spoken ? 'true' : undefined}
				>
					{item.value}
				</span>
				{#if spoken}<span class="sr-only">{spoken}</span>{/if}
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
