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
	/** Wide layout: the first half on the left, the rest on the right, each from the top row. */
	const placement = (index: number) =>
		index < leftCount
			? { side: 'left', row: index + 1 }
			: { side: 'right', row: index - leftCount + 1 };

	/** The list and the centre share these columns; the list leaves the middle one empty. */
	const WIDE_COLUMNS = '@xl:grid-cols-[1fr_minmax(8rem,11rem)_1fr] @xl:gap-x-4';
</script>

<div class={['grid gap-3 @xl:items-center', WIDE_COLUMNS]}>
	<p
		class="m-0 rounded-[15px] border-2 border-primary bg-accent-subtle p-4 @xl:col-start-2 @xl:row-start-1"
	>
		<NodeText node={center} align="center" />
	</p>
	<ul class={['grid gap-2 @xl:col-span-3 @xl:col-start-1 @xl:row-start-1', WIDE_COLUMNS]}>
		{#each spokes as spoke, index (index)}
			{@const { side, row } = placement(index)}
			<li
				class={[
					'relative rounded-[13px] border border-l-4 border-l-primary bg-surface-2 px-3 py-2.5 @xl:[grid-row:var(--row)]',
					'@xl:after:absolute @xl:after:top-1/2 @xl:after:h-0.5 @xl:after:w-4 @xl:after:bg-primary/60',
					side === 'left'
						? '@xl:col-start-1 @xl:after:-right-[18px]'
						: '@xl:col-start-3 @xl:border-r-4 @xl:border-l @xl:border-r-primary @xl:border-l-stroke @xl:after:-left-[18px]'
				]}
				style:--row={row}
			>
				<NodeText node={spoke} />
			</li>
		{/each}
	</ul>
</div>
