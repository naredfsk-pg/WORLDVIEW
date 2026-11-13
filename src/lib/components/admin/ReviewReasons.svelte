<script lang="ts">
	import { REVIEW_REASON_LABEL_TH } from './admin-labels';
	import type { ReviewReason } from '#lib/types/domain.js';

	let { reasons }: { reasons: readonly ReviewReason[] } = $props();
</script>

{#if reasons.length > 0}
	<ul class="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="เหตุผลที่ต้องตรวจสอบ">
		{#each reasons as reason (reason)}
			<li
				class="rounded-full border border-gold/30 bg-gold-bg px-2.5 py-0.5 text-[11px] font-semibold text-gold"
			>
				{REVIEW_REASON_LABEL_TH[reason]}
			</li>
		{/each}
	</ul>
{/if}
