<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatUsage } from '#lib/components/admin/admin-labels.js';
	import JobRunList from '#lib/components/admin/JobRunList.svelte';
	import { formatThaiDateTimeShort } from '#lib/components/format.js';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const usage = $derived(data.llm_usage);
	const backlog = $derived(data.review_counts.events + data.review_counts.relations);
</script>

<SeoHead title="ภาพรวมระบบ (ผู้ดูแล)" description="สถานะงานระบบ แหล่งข่าว และการใช้ AI" noindex />

<PageIntro eyebrow="ADMIN · DASHBOARD" title="ภาพรวมระบบ" />

<section aria-labelledby="summary-heading" class="mb-[26px]">
	<h2 id="summary-heading" class="sr-only">สรุป</h2>
	<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
		<a
			href={resolve('/admin/review')}
			class="min-w-0 rounded-2xl border bg-card px-4 py-3.5 hover:border-primary"
			data-testid="review-backlog"
		>
			<p class="m-0 text-[11px] font-semibold text-muted-foreground">รอตรวจสอบ</p>
			<p class="mt-1 mb-0 text-[24px] font-bold">{backlog}</p>
			<p class="m-0 text-[11px] text-muted-foreground">
				เหตุการณ์ {data.review_counts.events} · ความเชื่อมโยง {data.review_counts.relations}
			</p>
		</a>
		<div class="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
			<p class="m-0 text-[11px] font-semibold text-muted-foreground">ความสดใหม่ของข้อมูล</p>
			<p class={['mt-1 mb-0 text-[15px] font-bold', data.freshness.stale && 'text-gold']}>
				{data.freshness.stale ? 'ข้อมูลอาจไม่เป็นปัจจุบัน' : 'ปกติ'}
			</p>
			<p class="m-0 text-[11px] text-muted-foreground">
				ดึงข่าวสำเร็จล่าสุด: {data.freshness.last_ingest_succeeded_at
					? formatThaiDateTimeShort(data.freshness.last_ingest_succeeded_at)
					: 'ยังไม่มี'}
			</p>
			<p class="m-0 text-[11px] text-muted-foreground">
				สรุปข่าวล่าสุด: {data.freshness.last_brief_published_at
					? formatThaiDateTimeShort(data.freshness.last_brief_published_at)
					: 'ยังไม่มี'}
			</p>
		</div>
		<div class="min-w-0 rounded-2xl border bg-card px-4 py-3.5" data-testid="llm-usage">
			<p class="m-0 text-[11px] font-semibold text-muted-foreground">AI วันนี้ (เวลาไทย): คำขอ</p>
			<p class="mt-1 mb-0 text-[15px] font-bold break-words">
				{formatUsage(usage.requests_today, usage.max_requests)}
			</p>
			<p class="m-0 text-[11px] text-muted-foreground">
				ล้มเหลว {usage.failures_today} · ใช้แคช {usage.cache_hits_today}
			</p>
		</div>
		<div class="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
			<p class="m-0 text-[11px] font-semibold text-muted-foreground">AI วันนี้: โทเคน</p>
			<p class="mt-1 mb-0 text-[15px] font-bold break-words">
				{formatUsage(usage.tokens_today, usage.max_tokens)}
			</p>
			<p class="m-0 text-[11px] text-muted-foreground">นับเฉพาะการเรียกจริง ไม่รวมแคช</p>
		</div>
	</div>
</section>

<div class="grid gap-[26px] xl:grid-cols-2">
	<section aria-labelledby="jobs-heading" class="min-w-0">
		<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
			<h2 id="jobs-heading" class="m-0 text-lg font-bold">งานระบบล่าสุด</h2>
			<a href={resolve('/admin/jobs')} class="text-[13px] font-bold text-primary hover:underline">
				ดูทั้งหมดและสั่งรันใหม่ →
			</a>
		</div>
		<JobRunList runs={data.job_runs} />
	</section>

	<section aria-labelledby="sources-heading" class="min-w-0">
		<h2 id="sources-heading" class="mt-0 mb-3 text-lg font-bold">สถานะแหล่งข่าว</h2>
		<ul class="m-0 grid list-none gap-2.5 p-0" data-testid="source-health">
			{#each data.sources as source (source.id)}
				<li class="min-w-0 rounded-xl border bg-card px-4 py-3">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="m-0 min-w-0 text-[13px] font-bold break-words">{source.name}</p>
						<span
							class={[
								'rounded-full px-2.5 py-0.5 text-[11px] font-bold',
								source.enabled
									? 'bg-accent-subtle text-primary'
									: 'bg-surface-2 text-muted-foreground'
							]}
						>
							{source.enabled ? 'เปิดใช้' : 'ปิดอยู่'}{source.is_demo ? ' · DEMO' : ''}
						</span>
					</div>
					<p class="mt-1 mb-0 text-[11px] text-muted-foreground">
						สำเร็จล่าสุด: {source.last_success_at
							? formatThaiDateTimeShort(source.last_success_at)
							: 'ยังไม่เคย'}
					</p>
					{#if source.last_error}
						<p class="mt-0.5 mb-0 text-[11px] break-words text-gold">
							ผิดพลาดล่าสุด{source.last_error_at
								? ` (${formatThaiDateTimeShort(source.last_error_at)})`
								: ''}: {source.last_error}
						</p>
					{/if}
				</li>
			{:else}
				<li class="text-[13px] text-muted-foreground">ยังไม่มีแหล่งข่าวในระบบ</li>
			{/each}
		</ul>
	</section>
</div>
