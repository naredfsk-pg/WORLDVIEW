<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';
	import Arrow from './Arrow.svelte';
	import NodeText from './NodeText.svelte';

	/**
	 * A loop: steps top to bottom, and a bracket on the left that returns from the last step to the
	 * first. The return is also stated in text, so the loop does not depend on the shape.
	 */
	let { steps }: { steps: InfographicNode[] } = $props();
</script>

<p class="mb-2 text-meta text-muted-foreground">
	<span aria-hidden="true">↻</span> ขั้นสุดท้ายวนกลับไปขั้นที่ 1 แล้วเริ่มรอบใหม่
</p>
<div class="relative pl-8">
	<!-- Return path: from the last card, along the left, back into the first card. -->
	<span
		aria-hidden="true"
		class="absolute top-6 bottom-6 left-1.5 w-5 rounded-l-[14px] border-2 border-r-0 border-primary/60"
	></span>
	<Arrow class="absolute top-[17px] left-[16px] -rotate-90" />
	<ol class="grid">
		{#each steps as step, index (index)}
			<li class="flex flex-col">
				<span class="flex items-start gap-2.5 rounded-[13px] border bg-surface-2 p-3">
					<span
						aria-hidden="true"
						class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
					>
						{index + 1}
					</span>
					<NodeText node={step} />
				</span>
				{#if index < steps.length - 1}
					<Arrow class="mx-auto my-1.5" />
				{/if}
			</li>
		{/each}
	</ol>
</div>
