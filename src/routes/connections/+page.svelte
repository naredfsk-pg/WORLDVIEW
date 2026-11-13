<script lang="ts">
	import ConnectionList from '#lib/components/ConnectionList.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FilterChips from '#lib/components/FilterChips.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const possibleCount = $derived(
		data.relations.filter((relation) => relation.relation_type === 'potential_impact').length
	);
</script>

<SeoHead
	title="ความเชื่อมโยงของเหตุการณ์"
	description="ดูว่าเหตุการณ์ต่าง ๆ เชื่อมถึงกันอย่างไร พร้อมประเภทความสัมพันธ์ เหตุผล และหลักฐานจากแหล่งข่าว"
/>

<PageIntro
	eyebrow="CONNECTIONS · THE BIGGER PICTURE"
	title="ทุกเหตุการณ์"
	accent="เชื่อมถึงกัน"
	description="ติดตามเรื่องราวที่ต่อเนื่องข้ามวัน สำรวจความสัมพันธ์ระหว่างข่าว พร้อมเหตุผลและหลักฐานของทุกความเชื่อมโยง"
/>

<div
	class="mb-[18px] flex flex-col items-start justify-between gap-[15px] rounded-2xl border bg-card px-[19px] py-4 md:flex-row md:items-center"
>
	<div>
		<p class="m-0 text-sm font-bold">ความเชื่อมโยงที่เผยแพร่ใน 30 วันล่าสุดของข้อมูล</p>
		<p class="mt-[3px] mb-0 text-xs text-muted-foreground">
			ทุกเส้นเชื่อมมีเหตุผลและลิงก์หลักฐาน · ป้าย “ตรวจโดยบรรณาธิการแล้ว” แสดงเฉพาะรายการที่ผ่านการตรวจ ·
			“อาจเกี่ยวข้อง/เป็นไปได้” หมายถึงยังไม่ยืนยันว่าเป็นเหตุและผล
		</p>
	</div>
	<span
		class="rounded-full bg-accent-subtle px-3 py-[7px] text-xs font-bold whitespace-nowrap text-primary"
	>
		{data.relations.length} ความสัมพันธ์ · {possibleCount} เป็นไปได้
	</span>
</div>

<FilterChips selected={data.category} action="/connections" />

{#if data.relations.length === 0}
	<EmptyState message="ยังไม่มีความเชื่อมโยงที่เผยแพร่ในหมวดนี้ช่วง 30 วันล่าสุด" />
{:else}
	<div class="max-w-[860px]">
		<ConnectionList relations={data.relations} />
	</div>
{/if}

<p class="pt-[25px] text-[11px] text-faint">
	เวอร์ชันนี้แสดงเป็นรายการ แผนภาพเครือข่าย (graph) จะตามมาใน Phase 2
</p>
