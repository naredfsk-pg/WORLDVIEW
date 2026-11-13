<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/** Decorative connector arrow (points down; rotate with `class`). Hidden from screen readers. */
	let { class: className }: { class?: ClassValue } = $props();
</script>

<svg
	viewBox="0 0 16 16"
	width="16"
	height="16"
	aria-hidden="true"
	focusable="false"
	class={['shrink-0 text-primary', className]}
>
	<path
		d="M8 2v11M3.5 8.5 8 13l4.5-4.5"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>
