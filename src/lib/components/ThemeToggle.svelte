<script lang="ts">
	import { onMount } from 'svelte';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { Button } from '#lib/components/ui/button/index.js';
	import { THEME_KEY, writeStorage, type Theme } from '#lib/stores/storage.js';

	// The initial theme is applied before paint by the inline script in app.html
	// (saved choice, else `prefers-color-scheme`). This button only flips and saves it.
	let isDark = $state(false);

	onMount(() => {
		isDark = document.documentElement.dataset.theme === 'dark';
	});

	function toggleTheme() {
		const next: Theme = isDark ? 'light' : 'dark';
		document.documentElement.dataset.theme = next;
		writeStorage(THEME_KEY, next);
		isDark = next === 'dark';
	}
</script>

<Button
	variant="outline"
	size="icon"
	class="size-11 rounded-xl bg-card lg:size-[38px]"
	aria-label="โหมดมืด"
	aria-pressed={isDark}
	title="สลับ Light / Dark"
	data-testid="theme-toggle"
	onclick={toggleTheme}
>
	<Moon class="size-[18px] dark:hidden" strokeWidth={1.8} aria-hidden="true" />
	<Sun class="hidden size-[18px] dark:block" strokeWidth={1.8} aria-hidden="true" />
</Button>
