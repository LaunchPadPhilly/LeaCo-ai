<script lang="ts">
	/** Stacked bar of status counts. The words underneath carry the meaning; color only adds to it. */
	let { parts, total, label }: { parts: { count: number; color: string; name: string }[]; total: number; label: string } = $props();
</script>

<div class="bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.count} ${p.name}`).join(', ')}, of ${total}`}>
	{#each parts as p (p.name)}
		{#if p.count > 0}<i style:width="{(p.count / Math.max(total, 1)) * 100}%" style:background={p.color}></i>{/if}
	{/each}
</div>

<style>
	.bar {
		display: flex;
		height: 7px;
		border-radius: 4px;
		overflow: hidden;
		background: var(--ops-sunken);
		gap: 1px;
	}

	.bar i {
		display: block;
		height: 100%;
	}
</style>
