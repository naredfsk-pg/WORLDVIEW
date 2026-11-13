<script lang="ts">
	/** The required `change_reason` input every admin action carries (stored in content_revisions). */
	let { id, label = 'เหตุผล (จำเป็น)' }: { id: string; label?: string } = $props();
</script>

<label class="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-semibold" for={id}>
	{label}
	<input
		{id}
		name="change_reason"
		required
		minlength="3"
		maxlength="300"
		autocomplete="off"
		placeholder="เช่น ตรวจแหล่งข่าวแล้ว"
		class="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-[13px] font-normal"
	/>
</label>
