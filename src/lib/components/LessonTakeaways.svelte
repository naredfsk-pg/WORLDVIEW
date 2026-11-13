<script lang="ts">
	/** "สรุปใน 30 วินาที": the lesson's 3–5 key points, shown before everything else. */
	let { takeaways }: { takeaways: string[] } = $props();
</script>

<section
	class="mb-6 rounded-[17px] border bg-hero p-5"
	aria-labelledby="takeaways"
	data-testid="lesson-takeaways"
>
	<h2 id="takeaways" class="mb-3 text-[17px] font-bold">สรุปใน 30 วินาที</h2>
	<ul class="grid gap-2.5">
		{#each takeaways as takeaway, index (index)}
			<li class="flex gap-2.5 text-[15px] leading-[1.75]">
				<span
					aria-hidden="true"
					class="mt-[3px] grid size-[22px] shrink-0 place-items-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground"
				>
					{index + 1}
				</span>
				<span class="min-w-0">{takeaway}</span>
			</li>
		{/each}
	</ul>
</section>
