<script lang="ts">
	import type { Infographic } from '#lib/types/domain.js';
	import CompareDiagram from './CompareDiagram.svelte';
	import CycleDiagram from './CycleDiagram.svelte';
	import FlowDiagram from './FlowDiagram.svelte';
	import HubDiagram from './HubDiagram.svelte';
	import LayersDiagram from './LayersDiagram.svelte';
	import StatsDiagram from './StatsDiagram.svelte';
	import TimelineDiagram from './TimelineDiagram.svelte';

	/**
	 * One lesson infographic: title, caption, the diagram and its source. Diagrams are HTML lists
	 * laid out with CSS (decorative shapes are aria-hidden), so the text is the text equivalent:
	 * screen readers get ordered/unordered lists, never just shapes.
	 */
	let { spec }: { spec: Infographic } = $props();

	const TYPE_LABELS: Record<Infographic['type'], string> = {
		flow: 'ลำดับเหตุและผล',
		cycle: 'วงจร',
		timeline: 'เส้นเวลา',
		compare: 'เปรียบเทียบ',
		hub: 'องค์ประกอบ',
		stats: 'ตัวเลขสำคัญ',
		layers: 'ลำดับชั้น'
	};
	const typeLabel = $derived(
		spec.type === 'layers' && spec.variant === 'pyramid' ? 'พีระมิด' : TYPE_LABELS[spec.type]
	);

	const id = $props.id();
</script>

<figure
	class="@container m-0 rounded-[17px] border bg-card p-4 sm:p-5"
	aria-labelledby="{id}-title"
	aria-describedby="{id}-summary"
	data-testid="infographic"
	data-type={spec.type}
>
	<p class="m-0 text-meta font-bold text-primary">ภาพสรุป · {typeLabel}</p>
	<h2 id="{id}-title" class="mt-1 mb-1 text-[17px] leading-[1.5] font-bold">{spec.title}</h2>
	<p id="{id}-summary" class="mb-4 text-sm leading-[1.75] text-muted-foreground">
		{spec.summary}
	</p>

	{#if spec.type === 'flow'}
		<FlowDiagram steps={spec.steps} />
	{:else if spec.type === 'cycle'}
		<CycleDiagram steps={spec.steps} />
	{:else if spec.type === 'timeline'}
		<TimelineDiagram events={spec.events} />
	{:else if spec.type === 'compare'}
		<CompareDiagram columns={spec.columns} />
	{:else if spec.type === 'hub'}
		<HubDiagram center={spec.center} spokes={spec.spokes} />
	{:else if spec.type === 'stats'}
		<StatsDiagram items={spec.items} />
	{:else if spec.type === 'layers'}
		<LayersDiagram layers={spec.layers} variant={spec.variant} />
	{/if}

	{#if spec.source}
		<figcaption class="mt-4 text-meta text-muted-foreground">ที่มา: {spec.source}</figcaption>
	{/if}
</figure>
