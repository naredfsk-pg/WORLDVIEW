<script lang="ts">
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import { JOB_TYPE_LABEL_TH } from '#lib/components/admin/admin-labels.js';
	import JobRunList from '#lib/components/admin/JobRunList.svelte';
	import ReasonField from '#lib/components/admin/ReasonField.svelte';
	import { formatThaiDateTimeShort } from '#lib/components/format.js';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SeoHead title="งานระบบ (ผู้ดูแล)" description="ประวัติการทำงานและการสั่งรันใหม่" noindex />

<PageIntro
	eyebrow="ADMIN · JOBS"
	title="งานระบบ"
	description="สั่งรันใหม่แบบบังคับ (--force --manual) ได้อย่างปลอดภัย: ข้อมูลไม่ซ้ำ งานที่กำลังทำงานอยู่จะไม่ถูกเริ่มซ้ำ สรุปข่าวจะสร้างได้หลังช่วงเวลาของรอบนั้นปิดแล้วเท่านั้น และต้องเว้นอย่างน้อย 5 นาทีระหว่างการสั่งรันงานเดียวกัน ทุกครั้งต้องระบุเหตุผล"
/>

<ActionNotice result={form} />

<section aria-labelledby="rerun-heading" class="mb-[26px]">
	<h2 id="rerun-heading" class="mt-0 mb-3 text-lg font-bold">สั่งรันใหม่</h2>
	<div class="grid gap-2.5 sm:grid-cols-2">
		{#each data.jobs as job (job.job_type)}
			<form
				method="POST"
				action="?/rerun"
				class="min-w-0 rounded-2xl border bg-card p-4"
				data-testid="rerun-{job.job_type}"
			>
				<input type="hidden" name="job_type" value={job.job_type} />
				<p class="mt-0 mb-1 text-[14px] font-bold">{JOB_TYPE_LABEL_TH[job.job_type]}</p>
				<p class="mt-0 mb-3 text-[12px] text-muted-foreground" data-testid="{job.job_type}-state">
					{job.running ? 'กำลังทำงานอยู่' : 'พร้อมสั่งรัน'}
				</p>
				<div class="flex flex-col gap-2.5">
					{#if job.takes_date}
						<label
							class="flex min-w-0 flex-col gap-1 text-[12px] font-semibold"
							for="date-{job.job_type}"
						>
							วันที่ (เวลาไทย)
							<input
								id="date-{job.job_type}"
								name="date"
								type="date"
								required
								value={job.job_type === 'archive_snapshot' ? data.yesterday : data.today}
								class="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-[13px] font-normal"
							/>
						</label>
					{/if}
					<ReasonField id="reason-{job.job_type}" />
					<div>
						<Button type="submit" disabled={job.running} class="min-h-10 px-3">รันตอนนี้</Button>
					</div>
				</div>
				{#if job.manual_reruns.length > 0}
					<ul class="mt-3 mb-0 grid list-none gap-1 p-0 text-[11px] text-muted-foreground">
						{#each job.manual_reruns as rerun (rerun.id)}
							<li class="break-words">
								{formatThaiDateTimeShort(rerun.created_at)} · {rerun.actor} · {rerun.reason}
							</li>
						{/each}
					</ul>
				{/if}
			</form>
		{/each}
	</div>
</section>

<section aria-labelledby="history-heading">
	<h2 id="history-heading" class="mt-0 mb-3 text-lg font-bold">ประวัติการทำงาน</h2>
	<JobRunList runs={data.runs} />
</section>
