<script lang="ts">
	import { TIMEZONE_LABEL } from '#lib/components/format.js';
	import { formatThaiDateTime } from '#lib/utils/date.js';
	import type { Freshness } from '#lib/types/views.js';

	let { freshness }: { freshness: Freshness } = $props();

	const lastUpdated = $derived(
		freshness.last_ingest_succeeded_at ?? freshness.last_brief_published_at
	);
	const lastUpdatedText = $derived(
		lastUpdated ? `${formatThaiDateTime(lastUpdated)} น. ${TIMEZONE_LABEL}` : 'ยังไม่มีการอัปเดต'
	);
</script>

<!-- Never claims live freshness: when stale it says so, with the real last-update time. -->
<p
	role="status"
	class={[
		'inline-flex items-center gap-[7px] rounded-lg border px-2.5 py-1.5 text-[11px]',
		freshness.stale
			? 'border-gold/25 bg-gold-bg text-gold'
			: 'border-transparent bg-surface-2 text-muted-foreground'
	]}
>
	<span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
	{freshness.stale ? 'ข้อมูลอาจไม่เป็นปัจจุบัน · ' : ''}อัปเดตล่าสุด {lastUpdatedText}
</p>
