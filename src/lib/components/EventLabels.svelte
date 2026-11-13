<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { DEMO_LABEL, SINGLE_SOURCE_LABEL } from '#lib/components/format.js';

	let { isDemo, sourceCount }: { isDemo: boolean; sourceCount: number } = $props();
</script>

{#if isDemo || sourceCount === 1}
	<span class="flex flex-wrap gap-1.5">
		{#if isDemo}
			<Badge
				class="h-auto rounded-md border-gold/25 bg-gold-bg px-2 py-0.5 text-[10px] font-semibold text-gold"
			>
				{DEMO_LABEL}
			</Badge>
		{/if}
		{#if sourceCount === 1}
			<Badge
				variant="outline"
				class="h-auto rounded-md px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
			>
				{SINGLE_SOURCE_LABEL}
			</Badge>
		{/if}
	</span>
{/if}
