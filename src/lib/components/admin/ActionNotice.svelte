<script lang="ts">
	import { REVIEW_REASON_LABEL_TH } from './admin-labels';
	import type { ReviewReason } from '#lib/types/domain.js';

	interface Props {
		result: { ok: boolean; message: string; reasons?: ReviewReason[] } | null | undefined;
	}

	let { result }: Props = $props();
</script>

{#if result}
	<div
		role={result.ok ? 'status' : 'alert'}
		data-testid="action-notice"
		class={[
			'mb-4 rounded-xl border px-4 py-3 text-[13px]',
			result.ok
				? 'border-primary/25 bg-accent-subtle text-primary'
				: 'border-gold/30 bg-gold-bg text-gold'
		]}
	>
		<p class="m-0 font-semibold">{result.message}</p>
		{#if result.reasons && result.reasons.length > 0}
			<ul class="mt-1.5 mb-0 list-disc pl-5" data-testid="gate-reasons">
				{#each result.reasons as reason (reason)}
					<li>{REVIEW_REASON_LABEL_TH[reason]}</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
