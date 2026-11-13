<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';
	import NodeText from './NodeText.svelte';

	/**
	 * Stacked levels, top first. `stack` numbers each level; `pyramid` indents the upper layers
	 * instead (less on narrow figures, so Thai text keeps a readable line length at 320 px).
	 */
	let { layers, variant }: { layers: InfographicNode[]; variant: 'stack' | 'pyramid' } = $props();

	/** 1 for the top layer, 0 for the base. */
	const inset = (index: number) =>
		variant === 'pyramid' && layers.length > 1
			? (layers.length - 1 - index) / (layers.length - 1)
			: 0;
</script>

<ol class="grid gap-1.5">
	{#each layers as layer, index (index)}
		<li
			class="mx-[calc(var(--inset)*7%)] rounded-[11px] border border-primary/30 bg-accent-subtle px-3 py-2.5 @xl:mx-[calc(var(--inset)*18%)]"
			style:--inset={inset(index)}
		>
			{#if variant === 'pyramid'}
				<NodeText node={layer} align="center" />
			{:else}
				<span class="flex items-start gap-2.5">
					<span
						aria-hidden="true"
						class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
					>
						{index + 1}
					</span>
					<NodeText node={layer} />
				</span>
			{/if}
		</li>
	{/each}
</ol>
