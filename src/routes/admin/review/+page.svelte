<script lang="ts">
	import { resolve } from '$app/paths';
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import EventReviewCard from '#lib/components/admin/EventReviewCard.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SeoHead title="คิวตรวจสอบ (ผู้ดูแล)" description="เหตุการณ์ที่รอผู้ดูแลตรวจสอบ" noindex />

<PageIntro
	eyebrow="ADMIN · REVIEW QUEUE"
	title="คิวตรวจสอบ"
	description="การเผยแพร่โดยผู้ดูแลตรวจเฉพาะเกณฑ์บังคับ G1–G3 (มีแหล่งข่าว, ข้อความไทยครบ, ไม่มี URL ในข้อความ) ทุกการทำรายการต้องระบุเหตุผล"
/>

<ActionNotice result={form} />

<p class="mb-4 text-[13px] text-muted-foreground">
	ความเชื่อมโยงที่รอตรวจ {data.relations.length} รายการ ·
	<a href={resolve('/admin/relations')} class="font-bold text-primary hover:underline">
		ไปที่คิวความเชื่อมโยง →
	</a>
</p>

<section aria-labelledby="pending-heading" class="mb-[30px]">
	<h2 id="pending-heading" class="mt-0 mb-3 text-lg font-bold">
		รอตรวจสอบ ({data.events.length})
	</h2>
	{#if data.events.length === 0}
		<EmptyState message="ไม่มีเหตุการณ์ที่รอตรวจสอบ" />
	{:else}
		<div class="grid gap-3">
			{#each data.events as event (event.id)}
				<EventReviewCard {event} />
			{/each}
		</div>
	{/if}
</section>

<section aria-labelledby="hidden-heading">
	<h2 id="hidden-heading" class="mt-0 mb-1 text-lg font-bold">ซ่อนอยู่</h2>
	<p class="mt-0 mb-3 text-[12px] text-muted-foreground">
		การเลิกซ่อนจะเผยแพร่อีกครั้ง และต้องผ่านเกณฑ์ G1–G3 เช่นเดียวกัน
	</p>
	{#if data.hidden_events.length === 0}
		<EmptyState message="ไม่มีเหตุการณ์ที่ซ่อนอยู่" />
	{:else}
		<div class="grid gap-3">
			{#each data.hidden_events as event (event.id)}
				<EventReviewCard {event} />
			{/each}
		</div>
	{/if}
</section>
