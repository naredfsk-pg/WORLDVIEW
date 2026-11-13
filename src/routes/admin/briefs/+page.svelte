<script lang="ts">
	import { resolve } from '$app/paths';
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import { BRIEF_STATUS_LABEL_TH } from '#lib/components/admin/admin-labels.js';
	import ReasonField from '#lib/components/admin/ReasonField.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import {
		EDITION_LABEL_TH,
		formatThaiDate,
		formatThaiDateTimeShort
	} from '#lib/components/format.js';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SeoHead title="สรุปข่าว (ผู้ดูแล)" description="ซ่อนหรือเผยแพร่สรุปข่าว" noindex />

<PageIntro
	eyebrow="ADMIN · BRIEFS"
	title="สรุปข่าวล่าสุด"
	description="ซ่อนสรุปข่าวที่มีปัญหาออกจากหน้าสาธารณะ หรือเผยแพร่อีกครั้ง ฉบับร่างคือรอบที่ไม่มีข่าวเข้าเกณฑ์"
/>

<ActionNotice result={form} />

{#if data.briefs.length === 0}
	<EmptyState message="ยังไม่มีสรุปข่าว" />
{:else}
	<ul class="m-0 grid list-none gap-3 p-0">
		{#each data.briefs as brief (brief.id)}
			<li class="min-w-0 rounded-2xl border bg-card p-4" data-testid="admin-brief">
				<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
					<p class="m-0 text-[14px] font-bold">
						{formatThaiDate(brief.brief_date, 'long')} · {EDITION_LABEL_TH[brief.edition]}
					</p>
					<span
						class={[
							'rounded-full px-2.5 py-0.5 text-[11px] font-bold',
							brief.status === 'published'
								? 'bg-accent-subtle text-primary'
								: 'bg-gold-bg text-gold'
						]}
					>
						{BRIEF_STATUS_LABEL_TH[brief.status]}
					</span>
				</div>
				<p class="mt-0 mb-3 text-[11px] text-muted-foreground">
					{brief.event_count} เหตุการณ์ · สร้างเมื่อ {formatThaiDateTimeShort(brief.generated_at)}
					{#if brief.status === 'published'}
						·
						<a
							href={resolve(`/brief/[date]?edition=${brief.edition}`, { date: brief.brief_date })}
							class="font-bold text-primary hover:underline">ดูหน้าสาธารณะ</a
						>
					{/if}
				</p>
				{#if brief.status !== 'draft'}
					<form
						method="POST"
						action="?/visibility"
						class="flex flex-col gap-2.5 sm:flex-row sm:items-end"
					>
						<input type="hidden" name="id" value={brief.id} />
						<input
							type="hidden"
							name="status"
							value={brief.status === 'published' ? 'hidden' : 'published'}
						/>
						<ReasonField id="reason-{brief.id}" />
						<Button
							type="submit"
							variant={brief.status === 'published' ? 'outline' : 'default'}
							class="min-h-10 px-3"
						>
							{brief.status === 'published' ? 'ซ่อน' : 'เลิกซ่อน'}
						</Button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
