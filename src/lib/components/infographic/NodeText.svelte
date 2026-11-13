<script lang="ts">
	import type { InfographicNode } from '#lib/types/domain.js';

	/** Label and optional detail of one infographic box (14px minimum for Thai text). */
	let { node, align = 'start' }: { node: InfographicNode; align?: 'start' | 'center' } = $props();
</script>

<span class={['block min-w-0', align === 'center' && 'text-center']}>
	<span class="block text-[15px] leading-[1.6] font-bold">{node.label}</span>
	{#if node.detail}
		<span class="mt-0.5 block text-sm leading-[1.7] text-muted-foreground">{node.detail}</span>
	{/if}
</span>
