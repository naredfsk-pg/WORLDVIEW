<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';
	import NodeText from './NodeText.svelte';

	/**
	 * A central concept with spokes. Narrow figures: the centre on top, spokes below in one
	 * column. Wide figures (36rem+): spokes split left and right of the centre, joined to it by
	 * short connector lines. Reading order is always centre, then spokes in spec order.
	 */
	let { center, spokes }: { center: InfographicNode; spokes: InfographicNode[] } = $props();

	const leftCount = $derived(Math.ceil(spokes.length / 2));
	const sides = $derived([
		{ side: 'left', items: spokes.slice(0, leftCount) },
		{ side: 'right', items: spokes.slice(leftCount) }
	] as const);
</script>

<div class="grid gap-3 @xl:grid-cols-[1fr_minmax(8rem,11rem)_1fr] @xl:items-center @xl:gap-x-4">
	<p
		class="m-0 rounded-[15px] border-2 border-primary bg-accent-subtle p-4 @xl:col-start-2 @xl:row-start-1"
	>
		<NodeText node={center} align="center" />
	</p>
	{#each sides as group (group.side)}
		<ul
			class={[
				'grid gap-2 @xl:row-start-1',
				group.side === 'left' ? '@xl:col-start-1' : '@xl:col-start-3'
			]}
		>
			{#each group.items as spoke, index (index)}
				<li
					class={[
						'relative rounded-[13px] border border-l-4 border-l-primary bg-surface-2 px-3 py-2.5',
						'@xl:after:absolute @xl:after:top-1/2 @xl:after:h-0.5 @xl:after:w-4 @xl:after:bg-primary/60',
						group.side === 'left'
							? '@xl:after:-right-[18px]'
							: '@xl:border-r-4 @xl:border-l @xl:border-r-primary @xl:border-l-stroke @xl:after:-left-[18px]'
					]}
				>
					<NodeText node={spoke} />
				</li>
			{/each}
		</ul>
	{/each}
</div>
