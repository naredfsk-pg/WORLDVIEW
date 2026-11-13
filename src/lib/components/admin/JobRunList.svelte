<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { formatThaiDateTimeShort } from '#lib/components/format.js';
	import type { JobRun } from '#lib/types/jobs.js';
	import { formatDuration, JOB_STATUS_LABEL_TH, JOB_TYPE_LABEL_TH } from './admin-labels';

	let { runs }: { runs: JobRun[] } = $props();
</script>

{#if runs.length === 0}
	<EmptyState message="ยังไม่มีประวัติการทำงานของระบบ" />
{:else}
	<ul class="m-0 grid list-none gap-2.5 p-0" data-testid="job-runs">
		{#each runs as run (run.id)}
			{@const counters = Object.entries(run.counters).filter(([, value]) => value !== 0)}
			<li class="min-w-0 rounded-xl border bg-card px-4 py-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="m-0 text-[13px] font-bold">{JOB_TYPE_LABEL_TH[run.job_type]}</p>
					<span
						class={[
							'rounded-full px-2.5 py-0.5 text-[11px] font-bold',
							run.status === 'succeeded' && 'bg-accent-subtle text-primary',
							run.status === 'running' && 'bg-surface-2 text-foreground',
							(run.status === 'failed' || run.status === 'partial') && 'bg-gold-bg text-gold'
						]}
					>
						{JOB_STATUS_LABEL_TH[run.status]}
					</span>
				</div>
				<p class="mt-1 mb-0 text-[11px] break-all text-muted-foreground">
					{run.idempotency_key} · {run.trigger === 'manual' ? 'สั่งเอง' : 'ตามตาราง'} · ครั้งที่ {run.attempts}
				</p>
				<p class="mt-0.5 mb-0 text-[11px] text-muted-foreground">
					เริ่ม {formatThaiDateTimeShort(run.started_at)} · ใช้เวลา {formatDuration(
						run.started_at,
						run.finished_at
					)}
				</p>
				{#if counters.length > 0}
					<p class="mt-1.5 mb-0 text-[11px] break-words text-foreground">
						{counters.map(([key, value]) => `${key}: ${value}`).join(' · ')}
					</p>
				{/if}
				{#if run.error}
					<p class="mt-1.5 mb-0 text-[11px] break-words text-gold">ข้อผิดพลาด: {run.error}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
