<script lang="ts">
	import { resolve } from '$app/paths';
	import ConnectionList from '#lib/components/ConnectionList.svelte';
	import EventLabels from '#lib/components/EventLabels.svelte';
	import EvidenceLinks from '#lib/components/EvidenceLinks.svelte';
	import LessonCard from '#lib/components/LessonCard.svelte';
	import SourceList from '#lib/components/SourceList.svelte';
	import {
		categoryLabel,
		EDITION_LABEL_TH,
		formatThaiDate,
		formatThaiDateTimeShort,
		regionsLabel,
		TIMEZONE_LABEL,
		UNKNOWN_OCCURRED_AT
	} from '#lib/components/format.js';
	import { academyProgress } from '#lib/stores/progress.svelte.js';
	import type { EventDetail } from '#lib/types/views.js';

	let { event }: { event: EventDetail } = $props();

	const regions = $derived(regionsLabel(event.regions));
</script>

{#snippet sectionHeading(id: string, title: string, subtitle: string)}
	<h2 {id} class="mb-2 text-[17px] font-bold">
		{title} <span class="text-xs font-normal text-muted-foreground">· {subtitle}</span>
	</h2>
{/snippet}

<article class="max-w-[760px]" data-testid="event-detail">
	<header class="mb-6">
		<p class="text-meta font-bold tracking-[0.09em] text-primary">
			{categoryLabel(event.category)}{regions ? ` · ${regions}` : ''}
		</p>
		<h1 class="mt-3 mb-3 text-[24px] leading-[1.45] font-bold tracking-[-0.03em] md:text-[30px]">
			{event.title_th}
		</h1>
		<p class="mb-3 text-[15px] leading-[1.9] text-muted-foreground">{event.summary_th}</p>
		<EventLabels isDemo={event.is_demo} sourceCount={event.source_count} />

		<!-- The note sits after the <dl>, inside the same box: a <dl> may only hold dt/dd groups
		     (BUG-QA-004). -->
		<div class="mt-4 rounded-2xl border bg-card p-4 text-xs">
			<dl class="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
				<div>
					<dt class="text-muted-foreground">เวลาเกิดเหตุ</dt>
					<dd class="font-semibold">
						{event.occurred_at ? formatThaiDateTimeShort(event.occurred_at) : UNKNOWN_OCCURRED_AT}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">วันที่ของเหตุการณ์ (วันที่พบข่าวครั้งแรก)</dt>
					<dd class="font-semibold">{formatThaiDate(event.event_date, 'long')}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">หลักฐานล่าสุด</dt>
					<dd class="font-semibold">{formatThaiDateTimeShort(event.last_updated_at)}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">เผยแพร่บน Worldview</dt>
					<dd class="font-semibold">{formatThaiDateTimeShort(event.published_at)}</dd>
				</div>
			</dl>
			<p class="mt-2 mb-0 text-meta text-faint">เวลาทั้งหมดเป็น{TIMEZONE_LABEL}</p>
		</div>
	</header>

	{#if event.corrections.length > 0}
		<aside
			class="mb-6 rounded-2xl border border-gold/25 bg-gold-bg p-4 text-[13px] text-gold"
			aria-label="การแก้ไขข้อมูล"
		>
			<p class="m-0 font-bold">มีการแก้ไขข้อมูลในเรื่องนี้</p>
			<ul class="mt-2 grid gap-1">
				{#each event.corrections as correction, index (index)}
					<li>{formatThaiDateTimeShort(correction.changed_at)} — {correction.note_th}</li>
				{/each}
			</ul>
		</aside>
	{/if}

	<div class="grid divide-y">
		<section class="py-5" aria-labelledby="facts">
			{@render sectionHeading('facts', 'ข้อเท็จจริง', 'What happened')}
			<p class="text-[14px] leading-[1.9]">{event.what_happened_th}</p>
			{#if event.claims.length > 0}
				<h3 class="mt-4 mb-2 text-[13px] font-bold">คำกล่าวอ้าง (ยังไม่ใช่ข้อเท็จจริงที่ยืนยัน)</h3>
				<ul class="grid gap-2">
					{#each event.claims as claim, index (index)}
						<li class="rounded-xl bg-surface-2 px-4 py-3 text-[13px] leading-[1.8]">
							<span class="font-semibold">{claim.claimant_th}:</span>
							“{claim.claim_th}”
							<EvidenceLinks urls={claim.evidence_source_urls} />
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="py-5" aria-labelledby="why">
			{@render sectionHeading('why', 'ทำไมเรื่องนี้สำคัญ', 'Why it matters')}
			<p class="text-[14px] leading-[1.9]">{event.why_it_matters_th}</p>
			<p class="m-0 rounded-xl bg-surface-2 px-3 py-2 text-meta text-muted-foreground">
				บทวิเคราะห์ส่วนนี้เรียบเรียงโดยมี AI ช่วย (AI-assisted) จากแหล่งข่าวด้านล่าง ควรอ่านประกอบกับแหล่งข่าวต้นทาง
			</p>
		</section>

		<section class="py-5" aria-labelledby="background">
			{@render sectionHeading('background', 'บริบทที่ควรรู้', 'Background')}
			<p class="m-0 text-[14px] leading-[1.9]">
				{event.background_th ?? 'ยังไม่มีข้อมูลบริบทเพิ่มเติมสำหรับเรื่องนี้'}
			</p>
		</section>

		<section class="py-5" aria-labelledby="uncertain">
			{@render sectionHeading('uncertain', 'สิ่งที่ยังไม่แน่นอน', 'Uncertainty')}
			<p class="m-0 text-[14px] leading-[1.9]">
				{event.uncertain_th ?? 'แหล่งข่าวยังไม่ได้ระบุประเด็นที่ไม่แน่นอนเพิ่มเติม'}
			</p>
		</section>

		<section class="py-5" aria-labelledby="sources">
			{@render sectionHeading('sources', 'แหล่งข่าวอ้างอิง', `${event.sources.length} แหล่ง`)}
			{#if event.source_count === 1}
				<p class="text-xs text-muted-foreground">
					เรื่องนี้มีแหล่งข่าวเพียงแหล่งเดียว ควรติดตามการยืนยันจากแหล่งอื่น
				</p>
			{/if}
			<SourceList sources={event.sources} />
		</section>

		<section class="py-5" aria-labelledby="timeline">
			{@render sectionHeading('timeline', 'ไทม์ไลน์และความคืบหน้า', 'Timeline')}
			{#if event.updates.length === 0}
				<p class="text-[13px] text-muted-foreground">ยังไม่มีความคืบหน้าเพิ่มเติม</p>
			{:else}
				<ol class="grid gap-3 border-l-2 border-accent-subtle pl-4">
					{#each event.updates as update (update.id)}
						<li class="text-[13px] leading-[1.8]">
							<p class="m-0 text-meta font-bold text-primary">
								รายงานเมื่อ {formatThaiDateTimeShort(update.reported_at)}
								{#if update.occurred_at}
									· เกิดเหตุ {formatThaiDateTimeShort(update.occurred_at)}
								{/if}
							</p>
							<p class="m-0">{update.update_text_th}</p>
							<EvidenceLinks urls={update.evidence_source_urls} />
						</li>
					{/each}
				</ol>
			{/if}
			{#if event.brief_appearances.length > 0}
				<p class="mt-4 mb-1 text-xs font-bold">อยู่ในสรุปข่าว</p>
				<ul class="flex flex-wrap gap-2">
					{#each event.brief_appearances as appearance (`${appearance.brief_date}-${appearance.edition}`)}
						<li>
							<a
								href={resolve(`/brief/[date]?edition=${appearance.edition}`, {
									date: appearance.brief_date
								})}
								class="inline-flex min-h-9 items-center rounded-full border bg-card px-3 text-xs text-muted-foreground hover:border-primary"
							>
								{formatThaiDate(appearance.brief_date)} · {EDITION_LABEL_TH[appearance.edition]}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="py-5" aria-labelledby="related-events">
			{@render sectionHeading('related-events', 'เหตุการณ์ที่เกี่ยวข้อง', 'Related events')}
			{#if event.relations.length === 0}
				<p class="text-[13px] text-muted-foreground">ยังไม่มีความเชื่อมโยงที่เผยแพร่</p>
			{:else}
				<ConnectionList relations={event.relations} currentEventId={event.id} />
			{/if}
		</section>

		<section class="py-5" aria-labelledby="related-lessons">
			{@render sectionHeading('related-lessons', 'บทเรียนที่เกี่ยวข้อง', 'Academy')}
			{#if event.lessons.length === 0}
				<p class="text-[13px] text-muted-foreground">ยังไม่มีบทเรียนที่เชื่อมโยง</p>
			{:else}
				<div class="grid gap-2.5">
					{#each event.lessons as lesson (lesson.id)}
						<LessonCard {lesson} completed={academyProgress.has(lesson.id)} />
					{/each}
				</div>
			{/if}
		</section>
	</div>
</article>
