<script lang="ts">
	import { resolve } from '$app/paths';
	import EventDetail from '#lib/components/EventDetail.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { CREDIBILITY_LABEL_TH } from '#lib/components/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// A shared link carries the credibility label too, not only the page.
	const description = $derived(
		data.event.credibility_level === 'none'
			? data.event.summary_th
			: `${CREDIBILITY_LABEL_TH[data.event.credibility_level]} · ${data.event.summary_th}`
	);
</script>

<SeoHead title={data.event.title_th} {description} />

<nav aria-label="เส้นทาง" class="mb-4 text-xs">
	<a href={resolve('/')} class="inline-flex min-h-9 items-center text-primary hover:underline"
		>← ข่าววันนี้</a
	>
</nav>

<EventDetail event={data.event} />
