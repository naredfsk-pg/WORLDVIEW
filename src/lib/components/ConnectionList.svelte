<script lang="ts">
	import { resolve } from '$app/paths';
	import EvidenceLinks from '#lib/components/EvidenceLinks.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { categoryLabel, formatThaiDate, RELATION_LABEL_TH } from '#lib/components/format.js';
	import type { EventSummary, RelationView } from '#lib/types/views.js';

	interface Props {
		relations: RelationView[];
		/** On an event page, that event is shown as text instead of a link. */
		currentEventId?: string;
	}

	let { relations, currentEventId }: Props = $props();
</script>

{#snippet endpoint(event: EventSummary)}
	<span class="block min-w-0">
		<span class="block text-[10px] font-bold text-primary">
			{categoryLabel(event.category)} · {formatThaiDate(event.event_date)}
		</span>
		{#if event.id === currentEventId}
			<span class="block text-[13px] leading-[1.6] font-semibold">{event.title_th} (เรื่องนี้)</span>
		{:else}
			<a
				href={resolve('/events/[id]', { id: event.id })}
				class="block text-[13px] leading-[1.6] font-semibold underline-offset-[3px] hover:text-primary hover:underline"
			>
				{event.title_th}
			</a>
		{/if}
	</span>
{/snippet}

<ul class="grid gap-2.5" data-testid="connection-list">
	{#each relations as relation (relation.id)}
		{@const possible = relation.relation_type === 'potential_impact'}
		<li
			class="rounded-2xl border bg-card p-4 sm:p-[19px]"
			data-relation-type={relation.relation_type}
		>
			{@render endpoint(relation.from_event)}
			<p
				class={[
					'my-3 inline-flex rounded-[9px] px-3 py-1.5 text-[11px] font-bold',
					possible
						? 'border border-dashed border-gold/40 bg-gold-bg text-gold'
						: 'bg-accent-subtle text-primary'
				]}
			>
				↓ {RELATION_LABEL_TH[relation.relation_type]}
			</p>
			{@render endpoint(relation.to_event)}
			<p class="mt-3 mb-2 text-xs leading-[1.8] text-muted-foreground">
				<span class="font-bold text-foreground">ทำไมจึงเชื่อมโยง:</span>
				{relation.explanation_th}
			</p>
			{#if possible}
				<p class="mb-2 text-[11px] text-gold">
					ความเชื่อมโยงนี้เป็นความเป็นไปได้ ยังไม่ได้รับการยืนยันว่าเป็นเหตุและผล
				</p>
			{/if}
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
				<EvidenceLinks urls={relation.evidence_source_urls} />
				{#if relation.reviewed}
					<Badge
						variant="outline"
						class="h-auto rounded-md px-2 py-0.5 text-[10px] text-muted-foreground"
					>
						ตรวจโดยบรรณาธิการแล้ว
					</Badge>
				{/if}
			</div>
		</li>
	{/each}
</ul>
