<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Component } from 'svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import House from '@lucide/svelte/icons/house';
	import Network from '@lucide/svelte/icons/network';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '#lib/components/ui/button/index.js';
	import DemoNotice from '#lib/components/DemoNotice.svelte';
	import FreshnessBadge from '#lib/components/FreshnessBadge.svelte';
	import SearchDialog from '#lib/components/SearchDialog.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { academyProgress } from '#lib/stores/progress.svelte.js';
	import type { ResolvedPathname } from '$app/types';
	import type { Freshness } from '#lib/types/views.js';

	interface Props {
		pathname: string;
		freshness: Freshness;
		demoMode: boolean;
		children: Snippet;
	}

	let { pathname, freshness, demoMode, children }: Props = $props();

	interface NavItem {
		href: ResolvedPathname;
		label: string;
		shortLabel: string;
		headerTitle: string;
		icon: Component;
		matches: (path: string) => boolean;
	}

	const LESSON_TOTAL = 30;
	const navItems: NavItem[] = [
		{
			href: resolve('/'),
			label: 'วันนี้',
			shortLabel: 'วันนี้',
			headerTitle: 'Daily Intelligence',
			icon: House,
			matches: (path) => path === '/' || path.startsWith('/brief') || path.startsWith('/events')
		},
		{
			href: resolve('/academy'),
			label: 'เรียนรู้โลก',
			shortLabel: 'เรียนรู้',
			headerTitle: 'World Academy',
			icon: BookOpen,
			matches: (path) => path.startsWith('/academy')
		},
		{
			href: resolve('/archive'),
			label: 'คลังข่าวย้อนหลัง',
			shortLabel: 'ย้อนหลัง',
			headerTitle: 'Historical Archive',
			icon: CalendarDays,
			matches: (path) => path.startsWith('/archive')
		},
		{
			href: resolve('/connections'),
			label: 'ความเชื่อมโยง',
			shortLabel: 'เชื่อมโยง',
			headerTitle: 'Knowledge Connections',
			icon: Network,
			matches: (path) => path.startsWith('/connections')
		}
	];

	let searchOpen = $state(false);
	const activeItem = $derived(navItems.find((item) => item.matches(pathname)));
	const headerTitle = $derived(activeItem?.headerTitle ?? 'Search');
	const progressPercent = $derived((academyProgress.count / LESSON_TOTAL) * 100);

	onMount(() => academyProgress.load());

	function openSearchWithSlash(event: KeyboardEvent) {
		if (event.key !== '/' || searchOpen || event.defaultPrevented) return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		event.preventDefault();
		searchOpen = true;
	}
</script>

<svelte:window onkeydown={openSearchWithSlash} />

<a
	href="#main"
	class="sr-only z-50 rounded-lg bg-card px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
>
	ข้ามไปยังเนื้อหาหลัก
</a>

{#snippet brandMark(size: 'sidebar' | 'header')}
	<span
		class={[
			'grid shrink-0 place-items-center bg-primary text-primary-foreground',
			size === 'sidebar' ? 'size-[35px] rounded-xl' : 'size-[30px] rounded-[10px]'
		]}
		aria-hidden="true"
	>
		<svg
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			stroke-width="1.65"
			class={size === 'sidebar' ? 'size-6' : 'size-5'}
		>
			<circle cx="16" cy="16" r="10.5" />
			<ellipse cx="16" cy="16" rx="4.2" ry="10.5" />
			<path d="M5.7 16h20.6M7.5 10.5h17m-17 11h17" />
		</svg>
	</span>
{/snippet}

<div class="min-h-svh lg:grid lg:grid-cols-[235px_minmax(0,1fr)]">
	<aside
		class="sticky top-0 hidden h-svh flex-col gap-[27px] self-start border-r bg-surface py-[27px] pr-4 pl-[23px] lg:flex"
		aria-label="แถบด้านข้าง"
	>
		<a href={resolve('/')} class="flex items-center gap-2.5 px-2" aria-label="Worldview หน้าหลัก">
			{@render brandMark('sidebar')}
			<span>
				<span class="block text-[19px] leading-[1.1] font-bold tracking-[-0.05em]">worldview</span>
				<span class="mt-0.5 block text-[9px] tracking-[0.04em] text-muted-foreground">
					MAKE SENSE OF THE WORLD
				</span>
			</span>
		</a>

		<div>
			<p
				class="mx-3 mt-2.5 mb-2 text-[10px] font-bold tracking-[0.13em] text-faint uppercase"
				aria-hidden="true"
			>
				Explore
			</p>
			<nav aria-label="เมนูหลัก" class="flex flex-col gap-1">
				{#each navItems as item (item.href)}
					{@const active = item === activeItem}
					<a
						href={item.href}
						aria-current={active ? 'page' : undefined}
						class={[
							'flex min-h-11 items-center gap-3 rounded-[11px] px-3 py-2.5 font-semibold',
							active
								? 'bg-accent-subtle text-primary'
								: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
						]}
					>
						<item.icon class="size-[19px]" strokeWidth={1.75} aria-hidden="true" />
						{item.label}
					</a>
				{/each}
			</nav>
		</div>

		<div class="mt-auto flex flex-col gap-3">
			<div class="rounded-2xl border bg-surface-2 p-4">
				<p class="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
					Your learning journey
				</p>
				<p class="my-[7px] text-[15px] font-semibold">Roadmap 30 วัน</p>
				<div
					class="h-1.5 overflow-hidden rounded-full bg-stroke"
					role="progressbar"
					aria-label="ความคืบหน้าบทเรียน"
					aria-valuemin={0}
					aria-valuemax={LESSON_TOTAL}
					aria-valuenow={academyProgress.count}
				>
					<div
						class="h-full bg-primary transition-[width] duration-300"
						style:width="{progressPercent}%"
					></div>
				</div>
				<p class="mt-2.5 text-[11px] text-muted-foreground">
					{academyProgress.count === 0
						? 'เริ่มต้นบทเรียนแรกของคุณ'
						: `เรียนแล้ว ${academyProgress.count} จาก ${LESSON_TOTAL} บทเรียน`}
				</p>
				<a
					href={resolve('/academy')}
					class="mt-1 inline-flex min-h-9 items-center text-xs font-bold text-primary hover:underline"
				>
					ไปยังบทเรียน →
				</a>
			</div>
			<p class="px-2 text-[10px] text-faint">Worldview © 2026 · MVP</p>
		</div>
	</aside>

	<div class="mx-auto w-full max-w-[1500px] min-w-0">
		<header
			class="mx-[18px] flex h-[69px] items-center justify-between gap-5 border-b md:mx-[25px] lg:mx-[42px] lg:h-[79px]"
		>
			<a
				href={resolve('/')}
				class="flex items-center gap-2 text-[17px] font-bold tracking-[-0.05em] lg:hidden"
				aria-label="Worldview หน้าหลัก"
			>
				{@render brandMark('header')}
				<span aria-hidden="true">worldview</span>
			</a>
			<div class="hidden flex-col gap-px lg:flex">
				<p class="text-xs font-bold">{headerTitle}</p>
				<p class="text-[11px] text-muted-foreground">ความรู้ที่ทำให้โลกเข้าใจง่ายขึ้น</p>
			</div>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="icon"
					class="size-11 rounded-xl bg-card lg:size-[38px]"
					aria-label="ค้นหาข่าวและบทเรียน (กด /)"
					title="ค้นหา ( / )"
					aria-haspopup="dialog"
					onclick={() => (searchOpen = true)}
				>
					<Search class="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
				</Button>
				<ThemeToggle />
			</div>
		</header>

		<main
			id="main"
			tabindex="-1"
			class="px-[18px] pt-6 pb-[calc(112px+env(safe-area-inset-bottom))] outline-none md:px-[25px] md:pt-[29px] lg:px-[42px] lg:pt-8 lg:pb-[70px]"
		>
			<div class="mb-[18px] flex flex-wrap gap-2">
				<FreshnessBadge {freshness} />
				{#if demoMode}
					<DemoNotice />
				{/if}
			</div>
			{@render children()}
		</main>
	</div>
</div>

<nav
	aria-label="นำทางหลัก"
	class="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-1.5 border-t bg-nav px-[15px] pt-[9px] pb-[calc(9px+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgb(0_0_0/0.025)] lg:hidden"
>
	{#each navItems as item (item.href)}
		{@const active = item === activeItem}
		<a
			href={item.href}
			aria-current={active ? 'page' : undefined}
			class={[
				'flex min-h-11 flex-1 flex-col items-center justify-center gap-[3px] rounded-[10px] px-0.5 py-[7px] text-[10px] font-semibold',
				active ? 'bg-accent-subtle text-primary' : 'text-muted-foreground'
			]}
		>
			<item.icon class="size-[19px]" strokeWidth={1.8} aria-hidden="true" />
			{item.shortLabel}
		</a>
	{/each}
</nav>

<SearchDialog bind:open={searchOpen} />
