<script lang="ts">
	import { isHttpUrl } from '#lib/components/format.js';

	let { urls }: { urls: string[] } = $props();

	// Several evidence refs can point at the same article: show each URL once. This also keeps
	// the {#each} keys unique (a duplicate key throws during hydration in Svelte 5).
	const uniqueUrls = $derived(urls.filter((url, index) => urls.indexOf(url) === index));
</script>

{#if uniqueUrls.length > 0}
	<span class="mt-1 flex flex-wrap items-center gap-x-3 text-[11px]" data-testid="evidence-links">
		{#each uniqueUrls as url, index (url)}
			{#if isHttpUrl(url)}
				<a
					href={url}
					target="_blank"
					rel="external noopener noreferrer"
					class="inline-flex min-h-8 items-center text-primary underline underline-offset-[3px]"
				>
					หลักฐาน {index + 1}<span class="sr-only"> (เปิดในแท็บใหม่)</span>
				</a>
			{:else}
				<span class="inline-flex min-h-8 items-center text-muted-foreground">
					หลักฐาน {index + 1} (ลิงก์ไม่ถูกต้อง)
				</span>
			{/if}
		{/each}
	</span>
{/if}
