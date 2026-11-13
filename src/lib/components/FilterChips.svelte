<script lang="ts">
	import { categoryLabel } from '#lib/components/format.js';
	import { CATEGORY_SLUGS, type CategorySlug } from '#lib/types/domain.js';

	interface Props {
		selected: CategorySlug | null;
		/** Path the GET form submits to; the category lives in the URL (`?category=`). */
		action: string;
		/** Other query params to keep (e.g. archive `month`/`date`). Empty values are dropped. */
		keep?: Record<string, string | null | undefined>;
	}

	let { selected, action, keep = {} }: Props = $props();

	const keptParams = $derived(
		Object.entries(keep).filter((entry): entry is [string, string] => Boolean(entry[1]))
	);
</script>

<!-- A GET form works without JS; with JS SvelteKit navigates client-side and keeps focus/scroll. -->
<form method="GET" {action} data-sveltekit-noscroll data-sveltekit-keepfocus>
	{#each keptParams as [name, value] (name)}
		<input type="hidden" {name} {value} />
	{/each}
	<div class="my-[18px] flex flex-wrap items-center gap-2" role="group" aria-label="กรองตามหมวดหมู่">
		{#each [null, ...CATEGORY_SLUGS] as slug (slug ?? 'all')}
			{@const pressed = slug === selected}
			<button
				type="submit"
				name={slug ? 'category' : undefined}
				value={slug ?? undefined}
				aria-pressed={pressed}
				data-testid="chip-{slug ?? 'all'}"
				class={[
					'min-h-9 rounded-full border px-3 py-[7px] text-xs whitespace-nowrap pointer-coarse:min-h-11',
					pressed
						? 'border-accent-subtle bg-accent-subtle font-bold text-primary'
						: 'bg-card text-muted-foreground hover:border-primary'
				]}
			>
				{slug ? categoryLabel(slug) : 'ทั้งหมด'}
			</button>
		{/each}
	</div>
</form>
