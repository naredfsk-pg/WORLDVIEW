<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatThaiDate, isHttpUrl } from '#lib/components/format.js';
	import Infographic from '#lib/components/infographic/Infographic.svelte';
	import LessonTakeaways from '#lib/components/LessonTakeaways.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { AcademyWeekMeta, LessonDetail } from '#lib/types/views.js';

	interface Props {
		lesson: LessonDetail;
		week: AcademyWeekMeta;
		/** Rendered after the reading material (mark-complete, related events, prev/next). */
		children?: Snippet;
	}

	let { lesson, week, children }: Props = $props();

	const dayLabel = $derived(String(lesson.day).padStart(2, '0'));

	let root: HTMLElement | undefined = $state();
	let allOpen = $state(false);

	function toggleAllSections() {
		allOpen = !allOpen;
		for (const section of foldedSections()) section.open = allOpen;
	}

	// In-page links (TOC, `#section-n`) can point into a folded section: open it first so the
	// browser can scroll to the target. Also keeps the "open all" label in sync with manual toggles.
	$effect(() => {
		if (!root) return;
		const container = root;
		const onClick = (event: MouseEvent) => {
			const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
			if (link) openSectionOf(link.getAttribute('href') ?? '');
		};
		const onHashChange = () => {
			if (openSectionOf(location.hash)) scrollToHashTarget();
		};
		const onToggle = () => {
			const sections = foldedSections();
			allOpen = sections.length > 0 && sections.every((section) => section.open);
		};

		if (openSectionOf(location.hash)) scrollToHashTarget();
		container.addEventListener('click', onClick);
		container.addEventListener('toggle', onToggle, true);
		window.addEventListener('hashchange', onHashChange);
		return () => {
			container.removeEventListener('click', onClick);
			container.removeEventListener('toggle', onToggle, true);
			window.removeEventListener('hashchange', onHashChange);
		};
	});

	function foldedSections(): HTMLDetailsElement[] {
		return [...(root?.querySelectorAll<HTMLDetailsElement>('details.lesson-more') ?? [])];
	}

	/** The browser scrolled before the section opened (a hidden target has no box): scroll again. */
	function scrollToHashTarget() {
		document.getElementById(location.hash.slice(1))?.scrollIntoView();
	}

	/** Opens the folded section holding `#id`; true when it had to be opened. */
	function openSectionOf(hash: string): boolean {
		const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
		const section = target?.closest('details');
		if (!section || section.open) return false;
		section.open = true;
		return true;
	}
</script>

{#snippet tocList()}
	<ol class="grid gap-1 text-[13px]">
		{#each lesson.toc as item (item.id)}
			<li class={item.level === 3 ? 'pl-4' : ''}>
				<a
					href="#{item.id}"
					class="block rounded-lg px-2 py-1.5 leading-[1.6] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
				>
					{item.text}
				</a>
			</li>
		{/each}
	</ol>
{/snippet}

<div class="grid items-start gap-8 xl:grid-cols-[minmax(0,760px)_250px]" bind:this={root}>
	<article class="min-w-0" data-testid="lesson-article">
		<header class="mb-6">
			<p class="text-meta font-bold tracking-[0.07em] text-primary">
				WEEK {lesson.week} · DAY {dayLabel} · {week.title_th}
			</p>
			<h1 class="mt-3 mb-3 text-[26px] leading-[1.4] font-bold tracking-[-0.03em] md:text-[34px]">
				{lesson.title}
			</h1>
			<p class="m-0 text-[15px] leading-[1.9] text-muted-foreground">{lesson.summary}</p>
		</header>

		<LessonTakeaways takeaways={lesson.takeaways} />

		<div class="mb-6 grid gap-4">
			{#each lesson.infographics as spec, index (index)}
				<Infographic {spec} />
			{/each}
		</div>

		{#if lesson.learning_objectives.length > 0}
			<section class="mb-6 rounded-[17px] border bg-card p-5" aria-labelledby="objectives">
				<h2 id="objectives" class="mb-2 text-sm font-bold">คุณจะได้เรียนรู้</h2>
				<ul class="list-disc pl-5 text-[13px] leading-[1.85] text-muted-foreground">
					{#each lesson.learning_objectives as objective, index (index)}
						<li>{objective}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if lesson.toc.length > 0}
			<details class="mb-6 rounded-[17px] border bg-card p-4 xl:hidden">
				<summary class="min-h-6 cursor-pointer text-sm font-bold">สารบัญ</summary>
				<nav aria-label="สารบัญ (มือถือ)" class="mt-2">{@render tocList()}</nav>
			</details>
		{/if}

		{#if lesson.has_folded_sections}
			<div
				class="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[13px] bg-surface-2 px-4 py-2.5"
			>
				<p class="m-0 text-meta text-muted-foreground">
					แต่ละหัวข้อแสดงย่อหน้าแรกไว้ กด “อ่านต่อ” เพื่ออ่านรายละเอียด
				</p>
				<Button
					variant="outline"
					class="min-h-11 rounded-[11px] text-xs font-bold"
					data-testid="toggle-all-sections"
					aria-expanded={allOpen}
					onclick={toggleAllSections}
				>
					{allOpen ? 'ย่อทุกหัวข้อ' : 'เปิดอ่านทุกหัวข้อ'}
				</Button>
			</div>
		{/if}

		<!-- The only {@html} in the app: server-rendered, raw HTML escaped, https-only links. -->
		<div class="lesson-prose">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderLessonMarkdown -->
			{@html lesson.html}
		</div>

		{#if lesson.glossary.length > 0}
			<section class="mt-10" aria-labelledby="glossary">
				<h2 id="glossary" class="mb-3 text-[19px] font-bold">อภิธานศัพท์</h2>
				<dl class="grid gap-2.5">
					{#each lesson.glossary as entry, index (index)}
						<div class="rounded-[13px] border bg-card px-4 py-3">
							<dt class="text-sm font-bold">
								{entry.term}
								<span class="font-normal text-muted-foreground">· {entry.term_th}</span>
							</dt>
							<dd class="mt-1 text-[13px] leading-[1.8] text-muted-foreground">
								{entry.definition}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/if}

		{#if lesson.key_questions.length > 0}
			<section class="mt-10" aria-labelledby="key-questions">
				<h2 id="key-questions" class="mb-3 text-[19px] font-bold">คำถามชวนคิด</h2>
				<ol class="list-decimal pl-5 text-[15px] leading-[1.9]">
					{#each lesson.key_questions as question, index (index)}
						<li>{question}</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if lesson.further_reading.length > 0}
			<section class="mt-10" aria-labelledby="further-reading">
				<h2 id="further-reading" class="mb-3 text-[19px] font-bold">อ่านเพิ่มเติม</h2>
				<ul class="grid gap-2 text-[13px] leading-[1.8]">
					{#each lesson.further_reading as reading, index (index)}
						{@const unverified = !isHttpUrl(reading.url) || /TODO/i.test(reading.note ?? '')}
						<li data-unverified={unverified}>
							{#if unverified}
								<span class="font-semibold">{reading.title}</span>
							{:else}
								<a
									href={reading.url}
									target="_blank"
									rel="external noopener noreferrer"
									class="font-semibold text-primary underline underline-offset-[3px]"
								>
									{reading.title}<span class="sr-only"> (เปิดในแท็บใหม่)</span>
								</a>
							{/if}
							<span class="text-muted-foreground"> — {reading.publisher}</span>
							{#if reading.note}
								<span class="text-faint"> ({reading.note})</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<p class="mt-8 text-meta text-faint">
			ตรวจทานเนื้อหาล่าสุด {formatThaiDate(lesson.last_reviewed_at, 'long')}
		</p>

		{@render children?.()}
	</article>

	{#if lesson.toc.length > 0}
		<aside class="sticky top-5 hidden rounded-[17px] border bg-card p-4 xl:block">
			<p class="mb-2 px-2 text-xs font-bold">สารบัญ</p>
			<nav aria-label="สารบัญ">{@render tocList()}</nav>
		</aside>
	{/if}
</div>
