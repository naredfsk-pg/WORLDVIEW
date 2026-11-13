<script lang="ts">
	import './layout.css';
	import { navigating, page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import notoThai400 from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2?url';
	import notoLatin400 from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff2?url';
	import notoThai700 from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2?url';
	import notoLatin700 from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff2?url';
	import AppShell from '#lib/components/AppShell.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Skeleton cards only for slow navigations to another page (filters stay on the same path).
	let showSkeleton = $state(false);
	$effect(() => {
		const target = navigating.to;
		if (!target || target.url.pathname === page.url.pathname) {
			showSkeleton = false;
			return;
		}
		const timer = setTimeout(() => (showSkeleton = true), 250);
		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- BUG-QA-010: fetch the body and heading faces with the HTML instead of after the CSS.
	     Late, staggered swaps (Latin subset first, Thai later) re-wrapped the /archive date row
	     twice on slow mobile (CLS 0.31). Same hashed files as the @fontsource CSS. -->
	{#each [notoThai400, notoLatin400, notoThai700, notoLatin700] as font (font)}
		<link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
	{/each}
</svelte:head>

<AppShell pathname={page.url.pathname} freshness={data.freshness} demoMode={data.demo_mode}>
	{#if showSkeleton}
		<div class="grid gap-3" aria-busy="true" aria-label="กำลังโหลด">
			<Skeleton class="h-10 w-2/3 rounded-xl" />
			<Skeleton class="h-5 w-1/2 rounded-lg" />
			{#each [1, 2, 3] as card (card)}
				<Skeleton class="h-[120px] w-full rounded-2xl" />
			{/each}
		</div>
	{:else}
		{@render children()}
	{/if}
</AppShell>
