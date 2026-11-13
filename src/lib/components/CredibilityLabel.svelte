<script lang="ts" module>
	import type { Component } from 'svelte';
	import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';
	import Scale from '@lucide/svelte/icons/scale';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { ShownCredibilityLevel } from '#lib/types/domain.js';

	// The text carries the meaning; icon and outline/fill only grade the emphasis (dashed →
	// solid → filled). Kept apart from the demo badge's light gold fill.
	const LEVEL_ICON: Record<ShownCredibilityLevel, Component> = {
		unverified: CircleQuestionMark,
		disputed: Scale,
		possible_misinformation: TriangleAlert
	};

	const LEVEL_CLASS: Record<ShownCredibilityLevel, string> = {
		unverified: 'border-dashed border-gold/60 bg-transparent text-gold',
		disputed: 'border-gold bg-transparent text-gold',
		possible_misinformation: 'border-gold bg-gold text-gold-bg'
	};
</script>

<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { CREDIBILITY_LABEL_TH } from '#lib/components/format.js';
	import type { CredibilityLevel } from '#lib/types/domain.js';

	let { level, class: className = '' }: { level: CredibilityLevel; class?: string } = $props();
</script>

{#if level !== 'none'}
	{@const Icon = LEVEL_ICON[level]}
	<Badge
		variant="outline"
		class="h-auto rounded-md px-2 py-0.5 text-meta font-semibold {LEVEL_CLASS[level]} {className}"
		data-testid="credibility-label"
		data-level={level}
	>
		<Icon aria-hidden="true" strokeWidth={2.2} />
		{CREDIBILITY_LABEL_TH[level]}
	</Badge>
{/if}
