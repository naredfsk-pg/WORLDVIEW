<script lang="ts">
	/**
	 * 2–3 columns side by side (stacked on narrow figures). Each column is a titled list; the header
	 * tints only repeat what the titles already say.
	 */
	let { columns }: { columns: { title: string; points: string[] }[] } = $props();

	const HEADER_TONES = [
		'bg-accent-subtle text-primary',
		'bg-gold-bg text-gold',
		'bg-surface-2 text-foreground'
	];
	const id = $props.id();
</script>

<div
	class={[
		'grid gap-3',
		columns.length === 2 ? '@lg:grid-cols-2' : '@lg:grid-cols-2 @2xl:grid-cols-3'
	]}
>
	{#each columns as column, index (index)}
		<div class="overflow-hidden rounded-[13px] border">
			<p
				id="{id}-column-{index}"
				class={['m-0 px-3 py-2 text-[15px] leading-[1.6] font-bold', HEADER_TONES[index]]}
			>
				{column.title}
			</p>
			<ul class="grid gap-2 p-3" aria-labelledby="{id}-column-{index}">
				{#each column.points as point, pointIndex (pointIndex)}
					<li class="flex gap-2 text-sm leading-[1.7]">
						<span aria-hidden="true" class="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary"
						></span>
						<span class="min-w-0">{point}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</div>
