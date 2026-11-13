<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';
	import Arrow from './Arrow.svelte';
	import NodeText from './NodeText.svelte';

	/**
	 * Steps in order, joined by arrows. Stacked by default; up to 4 steps sit in one row when the
	 * figure is at least 36rem wide (container query), so long Thai text never gets squeezed.
	 */
	let { steps }: { steps: InfographicNode[] } = $props();

	const horizontal = $derived(steps.length <= 4);
</script>

<ol class={['grid gap-0', horizontal && '@xl:auto-cols-fr @xl:grid-flow-col']}>
	{#each steps as step, index (index)}
		<li class={['flex flex-col items-stretch', horizontal && '@xl:flex-row @xl:items-center']}>
			<span
				class="flex flex-1 items-start gap-2.5 rounded-[13px] border bg-surface-2 p-3 @xl:self-stretch"
			>
				<span
					aria-hidden="true"
					class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>
					{index + 1}
				</span>
				<NodeText node={step} />
			</span>
			{#if index < steps.length - 1}
				<Arrow class={['mx-auto my-1.5', horizontal && '@xl:mx-1.5 @xl:-rotate-90']} />
			{/if}
		</li>
	{/each}
</ol>
