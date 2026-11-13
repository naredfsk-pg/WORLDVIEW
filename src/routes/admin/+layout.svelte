<script lang="ts">
	import { page } from '$app/state';
	import AdminNav from '#lib/components/admin/AdminNav.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if data.admin_dev_bypass}
	<div
		role="alert"
		data-testid="dev-bypass-banner"
		class="mb-4 rounded-xl border-2 border-dashed border-gold bg-gold-bg px-4 py-3 text-[13px] font-bold text-gold"
	>
		โหมดพัฒนา (vite dev): ข้ามการยืนยันตัวตน Cloudflare Access เพราะยังไม่ได้ตั้งค่า Access · ใช้ไม่ได้ใน
		production build
	</div>
{/if}

<AdminNav pathname={page.url.pathname} email={data.admin.email} />

{@render children()}
