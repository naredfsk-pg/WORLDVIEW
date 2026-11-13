<script lang="ts">
	interface Props {
		eyebrow: string;
		title: string;
		/** Second part of the headline, in the accent colour. */
		accent?: string;
		/** Put the accent on its own line (Today), instead of inline. */
		stacked?: boolean;
		description?: string;
	}

	let { eyebrow, title, accent, stacked = false, description }: Props = $props();
</script>

<div class="mb-[25px]">
	<p class="mb-[11px] text-[10px] font-bold tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
	<h1
		class="mb-3 text-[30px] leading-[1.3] font-bold tracking-[-0.03em] sm:text-[clamp(31px,4vw,46px)]"
	>
		{title}{#if accent}<span class={['text-primary', stacked && 'block']}
				>{stacked ? '' : ' '}{accent}</span
			>{/if}
	</h1>
	{#if description}
		<p class="m-0 max-w-[670px] text-[13px] leading-[1.85] text-muted-foreground sm:text-sm">
			{description}
		</p>
	{/if}
</div>
