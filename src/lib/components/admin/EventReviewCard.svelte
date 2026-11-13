<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { categoryLabel, formatThaiDateTimeShort } from '#lib/components/format.js';
	import type { AdminEventRow } from '#lib/types/views.js';
	import ReasonField from './ReasonField.svelte';
	import ReviewReasons from './ReviewReasons.svelte';

	let { event }: { event: AdminEventRow } = $props();

	const title = $derived(event.title_th || event.fallback_title || event.id);
	const hidden = $derived(event.status === 'hidden');
</script>

<article
	class="min-w-0 rounded-2xl border bg-card p-4"
	data-testid="review-event"
	data-id={event.id}
>
	<div class="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
		<span>{event.category ? categoryLabel(event.category) : 'ยังไม่มีหมวดหมู่'}</span>
		<span aria-hidden="true">·</span>
		<span>{event.source_count} แหล่งข่าว</span>
		<span aria-hidden="true">·</span>
		<span>อัปเดต {formatThaiDateTimeShort(event.last_updated_at)}</span>
	</div>
	<h3 class="mt-0 mb-2 text-[15px] leading-snug font-bold break-words">
		<a href={resolve('/admin/events/[id]', { id: event.id })} class="hover:text-primary">{title}</a>
	</h3>
	<div class="mb-3"><ReviewReasons reasons={event.review_reasons} /></div>

	<form method="POST" class="flex flex-col gap-2.5 sm:flex-row sm:items-end">
		<input type="hidden" name="id" value={event.id} />
		<ReasonField id="reason-{event.id}" />
		<div class="flex flex-wrap gap-2">
			<Button type="submit" formaction="?/publish" class="min-h-10 px-3">
				{hidden ? 'เลิกซ่อนและเผยแพร่' : 'เผยแพร่'}
			</Button>
			{#if !hidden}
				<Button type="submit" formaction="?/hide" variant="outline" class="min-h-10 px-3"
					>ซ่อน</Button
				>
				<Button type="submit" formaction="?/flag" variant="outline" class="min-h-10 px-3">
					ทำเครื่องหมายตรวจ
				</Button>
			{/if}
		</div>
	</form>
</article>
