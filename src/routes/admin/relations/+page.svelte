<script lang="ts">
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import RelationReviewCard from '#lib/components/admin/RelationReviewCard.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SeoHead title="ความเชื่อมโยง (ผู้ดูแล)" description="ตรวจและยกเลิกความเชื่อมโยง" noindex />

<PageIntro
	eyebrow="ADMIN · RELATIONS"
	title="ความเชื่อมโยง"
	description="ตรวจเหตุผลและลิงก์หลักฐานก่อนอนุมัติ ความสัมพันธ์เชิงเหตุผล (ตอบสนองต่อ / อาจส่งผล) ต้องให้คนยืนยันเสมอ ความเชื่อมโยงที่เผยแพร่แล้วแต่ผิดสามารถยกเลิกได้"
/>

<ActionNotice result={form} />

<section aria-labelledby="pending-relations-heading" class="mb-[30px]">
	<h2 id="pending-relations-heading" class="mt-0 mb-3 text-lg font-bold">
		รอตรวจสอบ ({data.relations.length})
	</h2>
	{#if data.relations.length === 0}
		<EmptyState message="ไม่มีความเชื่อมโยงที่รอตรวจสอบ" />
	{:else}
		<div class="grid gap-3" data-testid="pending-relations">
			{#each data.relations as relation (relation.id)}
				<RelationReviewCard {relation} />
			{/each}
		</div>
	{/if}
</section>

<section aria-labelledby="published-relations-heading">
	<h2 id="published-relations-heading" class="mt-0 mb-1 text-lg font-bold">
		เผยแพร่แล้ว ({data.published_relations.length})
	</h2>
	<p class="mt-0 mb-3 text-[12px] text-muted-foreground">
		แสดงเฉพาะรายการล่าสุด การยกเลิกจะเปลี่ยนสถานะเป็น "ปฏิเสธแล้ว" และบันทึกประวัติ
	</p>
	{#if data.published_relations.length === 0}
		<EmptyState message="ยังไม่มีความเชื่อมโยงที่เผยแพร่" />
	{:else}
		<div class="grid gap-3" data-testid="published-relations">
			{#each data.published_relations as relation (relation.id)}
				<RelationReviewCard {relation} />
			{/each}
		</div>
	{/if}
</section>
