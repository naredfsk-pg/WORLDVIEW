<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';
	import NodeText from './NodeText.svelte';

	/** Dated milestones, oldest first, on a vertical line. */
	let { events }: { events: (InfographicNode & { date: string })[] } = $props();
</script>

<ol class="relative ml-1.5 border-l-2 border-primary/50 pl-5">
	{#each events as event, index (index)}
		<li class="relative pb-4 last:pb-0">
			<span
				aria-hidden="true"
				class="absolute top-[7px] -left-[27px] size-3 rounded-full border-2 border-primary bg-card"
			></span>
			<span
				class="mb-1 inline-block rounded-md bg-accent-subtle px-2 py-0.5 text-meta font-bold text-primary"
			>
				{event.date}
			</span>
			<NodeText node={event} />
		</li>
	{/each}
</ol>
