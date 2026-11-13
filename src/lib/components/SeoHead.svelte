<script lang="ts">
	import { page } from '$app/state';

	interface Props {
		title: string;
		description: string;
		/** Set for pages that should not be indexed (errors, search results). */
		noindex?: boolean;
	}

	let { title, description, noindex = false }: Props = $props();

	const SITE_NAME = 'Worldview';
	const fullTitle = $derived(`${title} · ${SITE_NAME}`);
	const siteUrl = $derived(String(page.data.site_url ?? '').replace(/\/$/, ''));
	const url = $derived(`${siteUrl}${page.url.pathname}`);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	{#if noindex}
		<meta name="robots" content="noindex" />
	{/if}
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:locale" content="th_TH" />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
</svelte:head>
