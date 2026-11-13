<script lang="ts">
	import { resolve } from '$app/paths';
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import {
		CREDIBILITY_OPTION_LABEL_TH,
		EVENT_STATUS_LABEL_TH
	} from '#lib/components/admin/admin-labels.js';
	import ReasonField from '#lib/components/admin/ReasonField.svelte';
	import ReviewReasons from '#lib/components/admin/ReviewReasons.svelte';
	import {
		categoryLabel,
		formatThaiDateTimeShort,
		isHttpUrl,
		UNKNOWN_PUBLISHED_AT
	} from '#lib/components/format.js';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { CATEGORY_SLUGS, CREDIBILITY_LEVELS } from '#lib/types/domain.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const event = $derived(data.event);
	const submitted = $derived(form && 'values' in form ? form.values : null);
	const fieldErrors = $derived<Record<string, string | undefined>>(
		(form && 'field_errors' in form && form.field_errors) || {}
	);

	const textFields = [
		{ name: 'title_th', label: 'หัวข้อ', max: 200, rows: 0, required: true },
		{ name: 'summary_th', label: 'สรุปสั้น', max: 600, rows: 3, required: true },
		{ name: 'what_happened_th', label: 'เกิดอะไรขึ้น', max: 3000, rows: 5, required: true },
		{ name: 'why_it_matters_th', label: 'ทำไมจึงสำคัญ', max: 2000, rows: 4, required: true },
		{ name: 'background_th', label: 'ภูมิหลัง (ไม่บังคับ)', max: 3000, rows: 4, required: false },
		{ name: 'uncertain_th', label: 'สิ่งที่ยังไม่ชัดเจน (ไม่บังคับ)', max: 1500, rows: 3, required: false }
	] as const;

	type EditableName =
		| (typeof textFields)[number]['name']
		| 'category'
		| 'credibility_level'
		| 'credibility_reason_th';
	const editableNames: EditableName[] = [
		...textFields.map((field) => field.name),
		'category',
		'credibility_level',
		'credibility_reason_th'
	];

	function valueOf(name: EditableName): string {
		return submitted?.[name] ?? event[name] ?? '';
	}

	/**
	 * The version the edit started from. After a rejected save the page keeps the ORIGINAL
	 * version and values (not the reloaded row), so a resubmit cannot overwrite a newer change.
	 */
	function loadedValueOf(name: EditableName): string {
		return submitted?.[`original_${name}`] ?? event[name] ?? '';
	}
	const loadedUpdatedAt = $derived(submitted?.loaded_updated_at ?? event.updated_at);

	function preview(value: unknown): string {
		const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
		return text.length > 160 ? `${text.slice(0, 160)}…` : text;
	}
</script>

<SeoHead title="แก้ไขเหตุการณ์ (ผู้ดูแล)" description="แก้ไขข้อความภาษาไทยของเหตุการณ์" noindex />

<PageIntro
	eyebrow="ADMIN · EVENT {EVENT_STATUS_LABEL_TH[event.status]}"
	title={event.title_th || 'เหตุการณ์ที่ยังไม่มีหัวข้อภาษาไทย'}
/>

<ActionNotice result={form} />

<div class="grid gap-[26px] xl:grid-cols-[minmax(0,1fr)_360px]">
	<div class="min-w-0">
		<section aria-labelledby="status-heading" class="mb-[26px] rounded-2xl border bg-card p-4">
			<h2 id="status-heading" class="mt-0 mb-2 text-base font-bold">
				สถานะ: <span data-testid="event-status">{EVENT_STATUS_LABEL_TH[event.status]}</span>
			</h2>
			<div class="mb-3"><ReviewReasons reasons={event.review_reasons} /></div>
			<p class="mt-0 mb-3 text-[12px] break-words" data-testid="event-credibility">
				ป้ายความน่าเชื่อถือ:
				<span class="font-bold">{CREDIBILITY_OPTION_LABEL_TH[event.credibility_level]}</span>
				{#if event.credibility_reason_th}
					<span class="text-muted-foreground">— {event.credibility_reason_th}</span>
				{/if}
			</p>
			{#if event.status === 'published'}
				<p class="mt-0 mb-3 text-[12px]">
					<a
						href={resolve('/events/[id]', { id: event.id })}
						class="font-bold text-primary hover:underline"
					>
						ดูหน้าสาธารณะ →
					</a>
				</p>
			{/if}
			<form method="POST" class="flex flex-col gap-2.5 sm:flex-row sm:items-end">
				<input type="hidden" name="id" value={event.id} />
				<ReasonField id="status-reason" />
				<div class="flex flex-wrap gap-2">
					{#if event.status !== 'published'}
						<Button type="submit" formaction="?/publish" class="min-h-10 px-3">
							{event.status === 'hidden' ? 'เลิกซ่อนและเผยแพร่' : 'เผยแพร่'}
						</Button>
					{:else if event.review_reasons.includes('new_evidence_pending')}
						<Button type="submit" formaction="?/publish" class="min-h-10 px-3">
							ยืนยันข้อความที่เผยแพร่อยู่
						</Button>
					{/if}
					{#if event.status !== 'hidden'}
						<Button type="submit" formaction="?/hide" variant="outline" class="min-h-10 px-3">
							ซ่อน
						</Button>
					{/if}
					{#if event.status === 'draft' || event.status === 'pending_review'}
						<Button type="submit" formaction="?/flag" variant="outline" class="min-h-10 px-3">
							ทำเครื่องหมายตรวจ
						</Button>
					{/if}
				</div>
			</form>
		</section>

		<section aria-labelledby="edit-heading">
			<h2 id="edit-heading" class="mt-0 mb-1 text-lg font-bold">แก้ไขข้อความภาษาไทย</h2>
			<p class="mt-0 mb-4 text-[12px] text-muted-foreground">
				ห้ามใส่ URL หรือชื่อโดเมนในข้อความ ลิงก์อ้างอิงมาจากแหล่งข่าวที่บันทึกไว้เท่านั้น · ทุกการบันทึกจะเก็บประวัติก่อน/หลัง
			</p>
			<form method="POST" action="?/save" class="flex flex-col gap-4" data-testid="edit-form">
				<input type="hidden" name="loaded_updated_at" value={loadedUpdatedAt} />
				{#each editableNames as name (name)}
					<input type="hidden" name="original_{name}" value={loadedValueOf(name)} />
				{/each}
				{#each textFields as field (field.name)}
					{@const fieldError = fieldErrors[field.name]}
					<label class="flex flex-col gap-1 text-[13px] font-semibold">
						{field.label}
						{#if field.rows === 0}
							<input
								name={field.name}
								value={valueOf(field.name)}
								maxlength={field.max}
								required={field.required}
								aria-invalid={fieldError ? 'true' : undefined}
								class="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-[14px] font-normal"
							/>
						{:else}
							<textarea
								name={field.name}
								rows={field.rows}
								maxlength={field.max}
								required={field.required}
								aria-invalid={fieldError ? 'true' : undefined}
								class="w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-[14px] leading-relaxed font-normal"
								>{valueOf(field.name)}</textarea
							>
						{/if}
						{#if fieldError}
							<span class="text-[12px] font-normal text-gold" role="alert">{fieldError}</span>
						{/if}
					</label>
				{/each}

				<label class="flex flex-col gap-1 text-[13px] font-semibold">
					หมวดหมู่
					<select
						name="category"
						required
						class="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-[14px] font-normal"
					>
						<option value="" disabled selected={!valueOf('category')}>เลือกหมวดหมู่</option>
						{#each CATEGORY_SLUGS as slug (slug)}
							<option value={slug} selected={valueOf('category') === slug}
								>{categoryLabel(slug)}</option
							>
						{/each}
					</select>
					{#if fieldErrors.category}
						<span class="text-[12px] font-normal text-gold" role="alert"
							>{fieldErrors.category}</span
						>
					{/if}
				</label>

				<fieldset class="m-0 flex min-w-0 flex-col gap-3 rounded-xl border p-3">
					<legend class="px-1 text-[13px] font-bold">ป้ายความน่าเชื่อถือ (แสดงต่อสาธารณะ)</legend>
					<p class="m-0 text-[12px] text-muted-foreground">
						ป้ายอธิบายคำกล่าวอ้างในเรื่องนี้ ไม่ใช่การประเมินสำนักข่าว
					</p>
					<label class="flex flex-col gap-1 text-[13px] font-semibold">
						ระดับป้าย
						<select
							name="credibility_level"
							aria-invalid={fieldErrors.credibility_level ? 'true' : undefined}
							class="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-[14px] font-normal"
						>
							{#each CREDIBILITY_LEVELS as level (level)}
								<option value={level} selected={valueOf('credibility_level') === level}
									>{CREDIBILITY_OPTION_LABEL_TH[level]}</option
								>
							{/each}
							<!-- Ends a manual override: the next re-summary sets the label again. -->
							<option value="auto" selected={valueOf('credibility_level') === 'auto'}
								>อัตโนมัติ (ให้ระบบประเมิน)</option
							>
						</select>
						<span class="text-[12px] font-normal text-muted-foreground">
							ระดับที่เลือกเองจะคงอยู่แม้ระบบสรุปข่าวใหม่ เลือก “อัตโนมัติ” เพื่อให้ระบบประเมินป้ายอีกครั้งในการสรุปครั้งถัดไป
						</span>
						{#if fieldErrors.credibility_level}
							<span class="text-[12px] font-normal text-gold" role="alert"
								>{fieldErrors.credibility_level}</span
							>
						{/if}
					</label>
					<label class="flex flex-col gap-1 text-[13px] font-semibold">
						เหตุผลของป้าย (ไม่บังคับ)
						<textarea
							name="credibility_reason_th"
							rows="2"
							maxlength="300"
							aria-describedby="credibility-reason-hint"
							aria-invalid={fieldErrors.credibility_reason_th ? 'true' : undefined}
							class="w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-[14px] leading-relaxed font-normal"
							>{valueOf('credibility_reason_th')}</textarea
						>
						<span
							id="credibility-reason-hint"
							class="text-[12px] font-normal text-muted-foreground"
						>
							ภาษาไทยหนึ่งประโยคที่เป็นกลาง ไม่ใส่ลิงก์หรือช่องทางติดต่อ (ไม่เกิน 300 ตัวอักษร)
						</span>
						{#if fieldErrors.credibility_reason_th}
							<span class="text-[12px] font-normal text-gold" role="alert"
								>{fieldErrors.credibility_reason_th}</span
							>
						{/if}
					</label>
				</fieldset>

				<div
					class="flex flex-col gap-3 rounded-xl border bg-surface-2 p-3 sm:flex-row sm:items-end"
				>
					<ReasonField id="save-reason" label="เหตุผลของการแก้ไข (จำเป็น ไม่แสดงต่อสาธารณะ)" />
					<label class="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-semibold">
						หมายเหตุการแก้ไขสาธารณะ (ไม่บังคับ)
						<input
							name="public_note_th"
							maxlength="300"
							value={submitted?.public_note_th ?? ''}
							placeholder="เช่น แก้ไขตัวเลขให้ตรงกับแหล่งข่าว"
							class="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-[13px] font-normal"
						/>
					</label>
				</div>
				{#if fieldErrors.change_reason}
					<p class="m-0 text-[12px] text-gold" role="alert">{fieldErrors.change_reason}</p>
				{/if}
				<div><Button type="submit" class="min-h-11 px-5">บันทึกการแก้ไข</Button></div>
			</form>
		</section>
	</div>

	<aside class="flex min-w-0 flex-col gap-[26px]">
		<section aria-labelledby="sources-heading">
			<h2 id="sources-heading" class="mt-0 mb-3 text-base font-bold">
				แหล่งข่าว ({data.sources.length})
			</h2>
			<ul class="m-0 grid list-none gap-2 p-0">
				{#each data.sources as source (source.article_id)}
					<li class="min-w-0 rounded-xl border bg-card px-3 py-2.5 text-[12px]">
						{#if isHttpUrl(source.url)}
							<a
								href={source.url}
								target="_blank"
								rel="external noopener noreferrer nofollow"
								class="font-semibold break-words text-primary hover:underline">{source.title}</a
							>
						{:else}
							<span class="font-semibold break-words">{source.title}</span>
						{/if}
						<p class="mt-0.5 mb-0 text-muted-foreground">
							{source.source_name} · {source.published_at
								? formatThaiDateTimeShort(source.published_at)
								: UNKNOWN_PUBLISHED_AT}
						</p>
						{#if source.excerpt}
							<!-- Internal only (PRD §4.2): plain text, never on public pages. -->
							<p class="mt-1.5 mb-0 break-words text-foreground" data-testid="source-excerpt">
								{source.excerpt}
							</p>
						{/if}
					</li>
				{:else}
					<li class="text-[12px] text-muted-foreground">ไม่มีแหล่งข่าวที่เชื่อมไว้</li>
				{/each}
			</ul>
		</section>

		<section aria-labelledby="revisions-heading">
			<h2 id="revisions-heading" class="mt-0 mb-3 text-base font-bold">
				ประวัติการแก้ไข ({data.revisions.length})
			</h2>
			<ol class="m-0 grid list-none gap-2 p-0" data-testid="revisions">
				{#each data.revisions as revision (revision.id)}
					<li class="min-w-0 rounded-xl border bg-card px-3 py-2.5 text-[12px]">
						<p class="m-0 font-semibold break-words">
							{formatThaiDateTimeShort(revision.changed_at)} · {revision.changed_by}
						</p>
						<p class="mt-0.5 mb-0 break-words">เหตุผล: {revision.change_reason}</p>
						{#if revision.public_note_th}
							<p class="mt-0.5 mb-0 break-words text-primary">
								หมายเหตุสาธารณะ: {revision.public_note_th}
							</p>
						{/if}
						<ul class="mt-1 mb-0 list-none p-0 text-muted-foreground">
							{#each Object.keys(revision.before_after.after ?? {}) as key (key)}
								<li class="break-words">
									<span class="font-semibold">{key}</span>: {preview(
										revision.before_after.before?.[key]
									)} → {preview(revision.before_after.after?.[key])}
								</li>
							{/each}
						</ul>
					</li>
				{:else}
					<li class="text-[12px] text-muted-foreground">ยังไม่มีการแก้ไข</li>
				{/each}
			</ol>
		</section>
	</aside>
</div>
