<script lang="ts">
	import { formatThaiDateTimeShort, UNKNOWN_PUBLISHED_AT } from '#lib/components/format.js';
	import type { SourceRef } from '#lib/types/views.js';

	let { sources }: { sources: SourceRef[] } = $props();
</script>

<ol class="grid gap-2.5">
	{#each sources as source (source.article_id)}
		<li class="rounded-[13px] border bg-card px-4 py-3">
			<p class="m-0 text-xs font-bold">{source.source_name}</p>
			{#if /^https?:\/\//.test(source.url)}
				<a
					href={source.url}
					target="_blank"
					rel="external noopener noreferrer"
					class="mt-1 block text-[13px] leading-[1.7] text-primary underline-offset-[3px] hover:underline"
				>
					{source.title}<span class="sr-only"> (เปิดในแท็บใหม่)</span> ↗
				</a>
			{:else}
				<p class="mt-1 mb-0 text-[13px] leading-[1.7]">{source.title}</p>
			{/if}
			<p class="mt-1 mb-0 text-[11px] text-muted-foreground">
				เผยแพร่ {source.published_at
					? formatThaiDateTimeShort(source.published_at)
					: UNKNOWN_PUBLISHED_AT}
			</p>
		</li>
	{/each}
</ol>
