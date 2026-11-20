<script lang="ts">
	import type { AttentionItem } from '$lib/leaco/ops/summary';

	let { items, title, onpick }: { items: AttentionItem[]; title: string; onpick: (key: string) => void } = $props();
	const shown = $derived(items.slice(0, 12));
</script>

<section class="attention" aria-labelledby="attention-title">
	<h2 id="attention-title" class="ops-eyebrow">{title} ({items.length})</h2>
	{#if items.length === 0}
		<p class="empty">Nothing flagged for this period.</p>
	{:else}
		<ul>
			{#each shown as item (item.asset.key + item.text)}
				<li>
					<button type="button" onclick={() => onpick(item.asset.key)}>
						<svg width="14" height="14" aria-hidden="true">
							{#if item.asset.kind === 'injector'}
								<path d="M7 1.5 L13 12.5 L1 12.5 Z" fill={item.severity === 'high' ? 'var(--ops-danger)' : '#9AA0A6'} />
							{:else}
								<circle cx="7" cy="7" r="5.5" fill={item.severity === 'high' ? 'var(--ops-danger)' : '#9AA0A6'} />
							{/if}
						</svg>
						<span>
							<b>{item.asset.name}</b>
							<span class="d">{item.text.length > 140 ? item.text.slice(0, 138) + '…' : item.text}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
		{#if items.length > shown.length}<p class="more">{items.length - shown.length} more. Narrow the period or pick a property to see them.</p>{/if}
	{/if}
</section>

<style>
	.attention {
		display: grid;
		gap: 6px;
	}

	ul {
		display: grid;
		gap: 2px;
	}

	button {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		text-align: left;
		width: 100%;
		padding: 7px 8px;
		border-radius: 8px;
		min-height: 44px;
	}

	button:hover {
		background: var(--ops-panel);
	}

	svg {
		flex: none;
		margin-top: 3px;
	}

	b {
		display: block;
		font-size: 13px;
	}

	.d {
		display: block;
		font-size: 12px;
		color: var(--ops-muted);
	}

	.empty,
	.more {
		font-size: 12px;
		color: var(--ops-muted);
		padding: 4px 8px;
	}
</style>
