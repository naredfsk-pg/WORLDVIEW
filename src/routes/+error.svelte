<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageIntro from '#lib/components/PageIntro.svelte';
	import SeoHead from '#lib/components/SeoHead.svelte';
	import { Button } from '#lib/components/ui/button/index.js';

	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? 'ไม่พบหน้าที่คุณต้องการ' : 'ระบบขัดข้องชั่วคราว');
	const message = $derived(
		notFound
			? 'หน้านี้อาจถูกย้าย ยังไม่เผยแพร่ หรือไม่มีอยู่ ลองกลับไปที่ข่าววันนี้หรือคลังข่าวย้อนหลัง'
			: (page.error?.message ?? 'เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่อีกครั้ง')
	);
</script>

<SeoHead {title} description={message} noindex />

<PageIntro eyebrow="ERROR {page.status}" {title} />

<EmptyState {message}>
	{#if !notFound}
		<Button href={page.url.pathname + page.url.search} class="min-h-11 px-4">ลองใหม่</Button>
	{/if}
	<Button href={resolve('/')} variant="outline" class="min-h-11 px-4">ข่าววันนี้</Button>
	<Button href={resolve('/archive')} variant="outline" class="min-h-11 px-4">คลังข่าวย้อนหลัง</Button>
	<Button href={resolve('/academy')} variant="outline" class="min-h-11 px-4">เรียนรู้โลก</Button>
</EmptyState>
