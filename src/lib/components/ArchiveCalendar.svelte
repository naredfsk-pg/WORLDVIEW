<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import {
		addMonths,
		formatThaiDate,
		formatThaiMonth,
		monthGrid,
		queryString
	} from '#lib/components/format.js';
	import type { BriefDate, CategorySlug, RegionSlug, YearMonth } from '#lib/types/domain.js';

	interface Props {
		month: YearMonth;
		selected: BriefDate | null;
		/** Dates in `month` with a published brief: the only selectable days. */
		available: BriefDate[];
		/** Active filters, carried through every calendar link. */
		category: CategorySlug | null;
		region: RegionSlug | null;
	}

	let { month, selected, available, category, region }: Props = $props();

	const WEEKDAYS = [
		['อา', 'อาทิตย์'],
		['จ', 'จันทร์'],
		['อ', 'อังคาร'],
		['พ', 'พุธ'],
		['พฤ', 'พฤหัสบดี'],
		['ศ', 'ศุกร์'],
		['ส', 'เสาร์']
	] as const;

	const weeks = $derived(monthGrid(month));
	const availableSet = $derived(new Set(available));
</script>

<section
	class="w-full rounded-[17px] border bg-card p-[19px] md:max-w-[460px]"
	aria-labelledby="calendar-title"
	data-testid="archive-calendar"
>
	<div class="mb-[18px] flex items-center justify-between gap-2">
		<a
			href={resolve(`/archive?${queryString({ month: addMonths(month, -1), category, region })}`)}
			class="grid size-11 place-items-center rounded-[10px] text-muted-foreground hover:bg-surface-2"
			aria-label="เดือนก่อนหน้า"
			data-sveltekit-noscroll
		>
			<ChevronLeft class="size-5" aria-hidden="true" />
		</a>
		<h2 id="calendar-title" class="m-0 text-[15px] font-bold">{formatThaiMonth(month)}</h2>
		<a
			href={resolve(`/archive?${queryString({ month: addMonths(month, 1), category, region })}`)}
			class="grid size-11 place-items-center rounded-[10px] text-muted-foreground hover:bg-surface-2"
			aria-label="เดือนถัดไป"
			data-sveltekit-noscroll
		>
			<ChevronRight class="size-5" aria-hidden="true" />
		</a>
	</div>

	<table class="w-full table-fixed border-separate border-spacing-[5px]">
		<thead>
			<tr>
				{#each WEEKDAYS as [short, full] (short)}
					<th scope="col" abbr={full} class="pb-2 text-center text-[10px] font-normal text-faint">
						{short}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each weeks as week, weekIndex (weekIndex)}
				<tr>
					{#each week as cell, dayIndex (cell?.date ?? `${weekIndex}-${dayIndex}`)}
						<td class="p-0 text-center">
							{#if cell && availableSet.has(cell.date)}
								{@const isSelected = cell.date === selected}
								<a
									href={resolve(`/archive?${queryString({ date: cell.date, category, region })}`)}
									aria-current={isSelected ? 'date' : undefined}
									aria-label="{formatThaiDate(cell.date, 'long')} มีสรุปข่าว"
									data-date={cell.date}
									data-sveltekit-noscroll
									class={[
										'relative grid h-[37px] place-items-center rounded-[10px] after:absolute after:bottom-[3px] after:size-1 after:rounded-full',
										isSelected
											? 'bg-primary font-bold text-primary-foreground after:bg-primary-foreground'
											: 'text-foreground after:bg-primary hover:bg-surface-2'
									]}
								>
									{cell.day}
								</a>
							{:else if cell}
								<span class="grid h-[37px] place-items-center text-muted-foreground/40">
									{cell.day}
								</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<p class="mt-3.5 mb-0 border-t pt-[13px] text-[11px] text-muted-foreground">
		<span class="text-primary" aria-hidden="true">•</span> จุดสีเขียวแสดงวันที่มีสรุปข่าว (เวลาไทย GMT+7)
	</p>
</section>
