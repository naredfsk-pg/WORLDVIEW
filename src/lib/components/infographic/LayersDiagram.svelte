<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';
	import NodeText from './NodeText.svelte';

	/**
	 * Stacked levels, top first. `pyramid` indents the upper layers (less on narrow figures, so
	 * Thai text keeps a readable line length at 320 px).
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
			<NodeText node={layer} align={variant === 'pyramid' ? 'center' : 'start'} />
		</li>
	{/each}
</ol>
