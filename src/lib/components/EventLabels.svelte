<script lang="ts">
	import CredibilityLabel from '#lib/components/CredibilityLabel.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { DEMO_LABEL, SINGLE_SOURCE_LABEL } from '#lib/components/format.js';
	import type { CredibilityLevel } from '#lib/types/domain.js';

	interface Props {
		isDemo: boolean;
		sourceCount: number;
		credibilityLevel: CredibilityLevel;
	}

	let { isDemo, sourceCount, credibilityLevel }: Props = $props();
</script>

{#if isDemo || sourceCount === 1 || credibilityLevel !== 'none'}
	<span class="flex flex-wrap gap-1.5">
		{#if isDemo}
			<Badge
				class="h-auto rounded-md border-gold/25 bg-gold-bg px-2 py-0.5 text-meta font-semibold text-gold"
			>
				{DEMO_LABEL}
			</Badge>
		{/if}
		<CredibilityLabel level={credibilityLevel} />
		{#if sourceCount === 1}
			<Badge
				variant="outline"
				class="h-auto rounded-md px-2 py-0.5 text-meta font-semibold text-muted-foreground"
			>
				{SINGLE_SOURCE_LABEL}
			</Badge>
		{/if}
	</span>
{/if}
