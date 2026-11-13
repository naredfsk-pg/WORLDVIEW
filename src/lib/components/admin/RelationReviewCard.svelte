<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { categoryLabel, isHttpUrl, RELATION_LABEL_TH } from '#lib/components/format.js';
	import type { AdminRelationEndpoint, AdminRelationRow } from '#lib/types/views.js';
	import { EVENT_STATUS_LABEL_TH } from './admin-labels';
	import ReasonField from './ReasonField.svelte';

	let { relation }: { relation: AdminRelationRow } = $props();

	const published = $derived(relation.status === 'published');
</script>

{#snippet endpoint(event: AdminRelationEndpoint)}
	<p class="mt-0 mb-0.5 text-[13px] font-semibold break-words">
		<a href={resolve('/admin/events/[id]', { id: event.id })} class="hover:text-primary"
			>{event.title_th || event.id}</a
		>
	</p>
	<p class="mt-0 mb-1 text-[11px] text-muted-foreground">
		{EVENT_STATUS_LABEL_TH[event.status]} · {event.category
			? categoryLabel(event.category)
			: 'ยังไม่มีหมวดหมู่'}
	</p>
{/snippet}

<article
	class="min-w-0 rounded-2xl border bg-card p-4"
	data-testid="review-relation"
	data-id={relation.id}
>
	<p class="mt-0 mb-2 text-[11px] font-bold text-primary">
		{RELATION_LABEL_TH[relation.relation_type]} · ความมั่นใจ {Math.round(relation.confidence * 100)}%
	</p>
	{@render endpoint(relation.from_event)}
	<p class="my-0.5 text-[11px] text-muted-foreground" aria-hidden="true">↓</p>
	{@render endpoint(relation.to_event)}
	<p class="mt-1 mb-2 text-[13px] break-words text-muted-foreground">{relation.explanation_th}</p>
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
			{#if published}
				<Button type="submit" formaction="?/reject" variant="outline" class="min-h-10 px-3">
					ยกเลิกการเผยแพร่
				</Button>
			{:else}
				<Button type="submit" formaction="?/approve" class="min-h-10 px-3">อนุมัติ</Button>
				<Button type="submit" formaction="?/reject" variant="outline" class="min-h-10 px-3">
					ปฏิเสธ
				</Button>
			{/if}
		</div>
	</form>
</article>
