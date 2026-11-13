<script lang="ts">
	import ActionNotice from '#lib/components/admin/ActionNotice.svelte';
	import { JOB_TYPE_LABEL_TH } from '#lib/components/admin/admin-labels.js';
	import JobRunList from '#lib/components/admin/JobRunList.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { JobType } from '#lib/types/jobs.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Wired after the digest lane merges (`runJobByType` in server/jobs/registry.ts). */
	const LATER_JOBS: JobType[] = ['digest', 'brief_morning', 'brief_evening', 'archive_snapshot'];
</script>

<SeoHead title="งานระบบ (ผู้ดูแล)" description="ประวัติการทำงานและการสั่งรันใหม่" noindex />

<PageIntro
	eyebrow="ADMIN · JOBS"
	title="งานระบบ"
	description="สั่งรันใหม่แบบบังคับ (--force --manual) ได้อย่างปลอดภัย: ข้อมูลไม่ซ้ำ และงานที่กำลังทำงานอยู่จะไม่ถูกเริ่มซ้ำ"
/>

<ActionNotice result={form} />

<section aria-labelledby="rerun-heading" class="mb-[26px]">
	<h2 id="rerun-heading" class="mt-0 mb-3 text-lg font-bold">สั่งรันใหม่</h2>
	<div class="grid gap-2.5 sm:grid-cols-2">
		<form method="POST" action="?/rerunIngest" class="min-w-0 rounded-2xl border bg-card p-4">
			<p class="mt-0 mb-1 text-[14px] font-bold">{JOB_TYPE_LABEL_TH.ingest}</p>
			<p class="mt-0 mb-3 text-[12px] text-muted-foreground" data-testid="ingest-state">
				{data.ingest_running ? 'กำลังทำงานอยู่' : 'พร้อมสั่งรัน'}
			</p>
			<Button type="submit" disabled={data.ingest_running} class="min-h-10 px-3">
				รันดึงข่าวตอนนี้
			</Button>
		</form>
		{#each LATER_JOBS as jobType (jobType)}
			<div class="min-w-0 rounded-2xl border border-dashed bg-card p-4 opacity-80">
				<p class="mt-0 mb-1 text-[14px] font-bold">{JOB_TYPE_LABEL_TH[jobType]}</p>
				<p class="mt-0 mb-3 text-[12px] text-muted-foreground">
					ใช้ได้หลังจากรวมงานส่วน digest เข้าระบบแล้ว
				</p>
				<Button type="button" disabled variant="outline" class="min-h-10 px-3">ยังไม่พร้อม</Button>
			</div>
		{/each}
	</div>
</section>

<section aria-labelledby="history-heading">
	<h2 id="history-heading" class="mt-0 mb-3 text-lg font-bold">ประวัติการทำงาน</h2>
	<JobRunList runs={data.runs} />
</section>
