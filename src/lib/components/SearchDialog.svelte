<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';

	let { open = $bindable(false) }: { open: boolean } = $props();
</script>

<!-- A plain GET form: SvelteKit turns the submit into a client-side navigation to /search?q=… -->
<Dialog.Root bind:open>
	<Dialog.Content
		class="top-[12svh] w-[min(560px,calc(100vw-28px))] max-w-none translate-y-0 gap-0 rounded-[21px] border bg-card p-6 ring-0 sm:max-w-none"
	>
		<Dialog.Title class="text-base font-bold">ค้นหาข่าวและบทเรียน</Dialog.Title>
		<Dialog.Description class="mt-1 text-xs text-muted-foreground">
			ค้นหาจากเหตุการณ์ที่เผยแพร่แล้วและบทเรียน 30 วัน
		</Dialog.Description>
		<form
			method="GET"
			action="/search"
			role="search"
			class="mt-4 flex gap-2"
			onsubmit={() => (open = false)}
		>
			<label for="search-dialog-q" class="sr-only">คำค้นหา</label>
			<input
				id="search-dialog-q"
				name="q"
				type="search"
				required
				maxlength="100"
				autocomplete="off"
				placeholder="เช่น เงินเฟ้อ, AI, สงครามเย็น"
				class="min-h-11 min-w-0 flex-1 rounded-[13px] border bg-surface-2 px-[15px] text-foreground placeholder:text-muted-foreground"
			/>
			<Button type="submit" class="min-h-11 rounded-[11px] px-4 font-bold">
				<Search aria-hidden="true" />
				ค้นหา
			</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>
