<script lang="ts">
	import type { Snippet } from 'svelte';

	let { message, children }: { message: string; children?: Snippet } = $props();
</script>

<div
	class="rounded-[17px] border border-dashed bg-card p-[29px] text-center text-[13px] text-muted-foreground"
	data-testid="empty-state"
>
	<p class="m-0">{message}</p>
	{#if children}
		<div class="mt-4 flex flex-wrap justify-center gap-2">{@render children()}</div>
	{/if}
</div>
