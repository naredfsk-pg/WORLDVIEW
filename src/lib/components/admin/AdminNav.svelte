<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';

	let { pathname, email }: { pathname: string; email: string } = $props();

	const items: { href: ResolvedPathname; label: string; exact: boolean }[] = [
		{ href: resolve('/admin'), label: 'ภาพรวม', exact: true },
		{ href: resolve('/admin/review'), label: 'คิวตรวจสอบ', exact: false },
		{ href: resolve('/admin/relations'), label: 'ความเชื่อมโยง', exact: false },
		{ href: resolve('/admin/briefs'), label: 'สรุปข่าว', exact: false },
		{ href: resolve('/admin/jobs'), label: 'งานระบบ', exact: false }
	];

	function isActive(item: (typeof items)[number]): boolean {
		return item.exact ? pathname === item.href : pathname.startsWith(item.href);
	}
</script>

<div class="mb-[22px] flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:p-4">
	<div class="flex flex-wrap items-center justify-between gap-2 px-1">
		<p class="m-0 text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
			WORLDVIEW ADMIN
		</p>
		<p class="m-0 min-w-0 text-[11px] break-all text-muted-foreground" data-testid="admin-email">
			เข้าสู่ระบบเป็น {email}
		</p>
	</div>
	<nav aria-label="เมนูผู้ดูแล" class="flex flex-wrap gap-1.5">
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				class={[
					'inline-flex min-h-10 items-center rounded-[10px] px-3 text-[13px] font-semibold',
					active
						? 'bg-accent-subtle text-primary'
						: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
				]}
			>
				{item.label}
			</a>
		{/each}
	</nav>
</div>
