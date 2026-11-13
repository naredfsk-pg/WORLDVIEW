<script lang="ts">
	import { resolve } from '$app/paths';
	import EventDetail from '#lib/components/EventDetail.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SeoHead title={data.event.title_th} description={data.event.summary_th} />

<nav aria-label="เส้นทาง" class="mb-4 text-xs">
	<a href={resolve('/')} class="inline-flex min-h-9 items-center text-primary hover:underline"
		>← ข่าววันนี้</a
	>
</nav>

<EventDetail event={data.event} />
