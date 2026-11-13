<script lang="ts">
	import { resolve } from '$app/paths';
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import ReasonField from '#lib/components/admin/ReasonField.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { isHttpUrl, RELATION_LABEL_TH } from '#lib/components/format.js';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SeoHead title="คิวความเชื่อมโยง (ผู้ดูแล)" description="ความเชื่อมโยงที่รอตรวจสอบ" noindex />

<PageIntro
	eyebrow="ADMIN · RELATIONS"
	title="ความเชื่อมโยงที่รอตรวจ"
	description="ตรวจเหตุผลและลิงก์หลักฐานก่อนอนุมัติ ความสัมพันธ์เชิงเหตุผล (ตอบสนองต่อ / อาจส่งผล) ต้องให้คนยืนยันเสมอ"
/>

<ActionNotice result={form} />

{#if data.relations.length === 0}
	<EmptyState message="ไม่มีความเชื่อมโยงที่รอตรวจสอบ" />
{:else}
	<div class="grid gap-3">
		{#each data.relations as relation (relation.id)}
			<article class="min-w-0 rounded-2xl border bg-card p-4" data-testid="review-relation">
				<p class="mt-0 mb-2 text-[11px] font-bold text-primary">
					{RELATION_LABEL_TH[relation.relation_type]} · ความมั่นใจ {Math.round(
						relation.confidence * 100
					)}%
				</p>
				<p class="mt-0 mb-1 text-[13px] font-semibold break-words">
					<a
						href={resolve('/admin/events/[id]', { id: relation.from_event_id })}
						class="hover:text-primary">{relation.from_event.title_th}</a
					>
				</p>
				<p class="my-0.5 text-[11px] text-muted-foreground" aria-hidden="true">↓</p>
				<p class="mt-0 mb-2 text-[13px] font-semibold break-words">
					<a
						href={resolve('/admin/events/[id]', { id: relation.to_event_id })}
						class="hover:text-primary">{relation.to_event.title_th}</a
					>
				</p>
				<p class="mt-0 mb-2 text-[13px] break-words text-muted-foreground">
					{relation.explanation_th}
				</p>
				<div class="mb-3">
					<p class="mt-0 mb-1 text-[11px] font-bold">หลักฐาน</p>
					<ul class="m-0 grid list-none gap-1 p-0 text-[12px]">
						{#each relation.evidence_source_urls as url (url)}
							<li class="min-w-0 break-all">
								{#if isHttpUrl(url)}
									<a
										href={url}
										target="_blank"
										rel="external noopener noreferrer nofollow"
										class="text-primary hover:underline">{url}</a
									>
								{:else}
									{url}
								{/if}
							</li>
						{:else}
							<li class="text-gold">ไม่พบลิงก์หลักฐานที่บันทึกไว้</li>
						{/each}
					</ul>
				</div>
				<form method="POST" class="flex flex-col gap-2.5 sm:flex-row sm:items-end">
					<input type="hidden" name="id" value={relation.id} />
					<ReasonField id="reason-{relation.id}" />
					<div class="flex flex-wrap gap-2">
						<Button type="submit" formaction="?/approve" class="min-h-10 px-3">อนุมัติ</Button>
						<Button type="submit" formaction="?/reject" variant="outline" class="min-h-10 px-3"
							>ปฏิเสธ</Button
						>
					</div>
				</form>
			</article>
		{/each}
	</div>
{/if}
