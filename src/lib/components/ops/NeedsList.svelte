<script lang="ts">
	import { googleDirectionsUrl } from '$lib/leaco/ops/directions';
	import { needsSummary, type NeedItem, type SetAside } from '$lib/leaco/ops/needs';

	/**
	 * "Needs a contractor": the first thing on the Overview (DESIGN.md → Layout). One row per
	 * asset: symbol · name and property · what's wrong and its source · actions. Shapes follow
	 * the status key, so color is never the only signal.
	 */
	let { items, periodText, setAside, onpick }: { items: NeedItem[]; periodText: string; setAside?: SetAside; onpick: (key: string) => void } = $props();

	const asideText = $derived.by(() => {
		if (!setAside) return null;
		const parts = [
			setAside.contractorSent ? `${setAside.contractorSent} with a contractor` : null,
			setAside.archived ? `${setAside.archived} archived` : null
		].filter(Boolean);
		return parts.length ? `${parts.join(' · ')}, not shown` : null;
	});

	const LIMIT = 8;
	let expanded = $state(false);
	const shown = $derived(expanded ? items : items.slice(0, LIMIT));
	const summary = $derived(needsSummary(items));
</script>

<section class="needs" aria-labelledby="needs-title">
	<div class="head">
		<div>
			<h2 id="needs-title">Needs a contractor</h2>
			<p class="sub">{items.length ? `${items.length} open · ${summary}` : `Nothing flagged · ${periodText}`}{#if asideText}<span> · {asideText}</span>{/if}</p>
		</div>
		{#if setAside}<a class="manage" href="/issues">Manage issues</a>{/if}
	</div>

	{#if items.length === 0}
		<div class="clear">
			<span class="tick" aria-hidden="true">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5 9-10" /></svg>
			</span>
			<p><b>All clear right now.</b> No wells shut down, no injectors stuck, no open tickets.</p>
		</div>
	{:else}
		<ul>
			{#each shown as item (item.key)}
				<li>
					<span class="glyph {item.kind}" class:inj={item.assetKind === 'injector'} aria-hidden="true">
						{#if item.kind === 'offline'}?{:else if item.kind === 'ticket'}!{:else}✕{/if}
					</span>
					<span class="who">
						<b>{item.name}</b>
						{#if item.property}<span class="small">{item.property}</span>{/if}
					</span>
					<span class="what">
						<span title={item.detail.length > 120 ? item.detail : undefined}><b class="state {item.kind}">{item.state}</b> · {item.detail.length > 120 ? `${item.detail.slice(0, 118).trimEnd()}…` : item.detail}</span>
						<span class="small">{item.source}</span>
					</span>
					<span class="acts">
						{#if item.location}
							<a class="btn" href={googleDirectionsUrl(item.location)} target="_blank" rel="noopener noreferrer">Directions</a>
						{/if}
						<button type="button" class="btn ghost" onclick={() => onpick(item.key)}>Details</button>
					</span>
				</li>
			{/each}
		</ul>
		{#if items.length > LIMIT}
			<button type="button" class="more" onclick={() => (expanded = !expanded)}>
				{expanded ? 'Show fewer' : `Show all ${items.length}`}
			</button>
		{/if}
	{/if}
</section>

<style>
	.needs {
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		overflow: hidden;
		min-width: 0;
	}

	.head {
		padding: 18px 20px 12px;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
	}

	.manage {
		font-weight: 600;
		color: var(--ops-accent);
		text-decoration: none;
		white-space: nowrap;
	}

	.manage:hover {
		text-decoration: underline;
	}

	h2 {
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.sub {
		margin-top: 4px;
		color: var(--ops-muted);
		font-size: 14px;
	}

	ul {
		display: grid;
	}

	li {
		display: grid;
		grid-template-columns: 28px minmax(0, 1.1fr) minmax(0, 2fr) auto;
		gap: 14px;
		align-items: center;
		padding: 12px 20px;
		border-top: 1px solid var(--ops-divider);
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		color: #fff;
		font-size: 13px;
		font-weight: 700;
		background: var(--ops-danger);
	}

	.glyph.inj {
		border-radius: 4px;
	}

	.glyph.offline {
		background: var(--ops-offline);
	}

	.glyph.ticket {
		background: var(--ops-warn-fill);
		border-radius: 5px;
	}

	.who,
	.what {
		display: grid;
		gap: 1px;
		min-width: 0;
		font-size: 14.5px;
	}

	.small {
		font-size: 13px;
		color: var(--ops-muted);
	}

	.state {
		color: var(--ops-danger);
	}

	.state.offline {
		color: var(--ops-ink-2);
	}

	.state.ticket {
		color: var(--ops-warn);
	}

	.acts {
		display: flex;
		gap: 8px;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 12px;
		border: 1px solid var(--ops-line);
		border-radius: 6px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ops-accent);
		text-decoration: none;
		background: var(--ops-panel);
	}

	.btn.ghost {
		border-color: transparent;
	}

	.btn:hover {
		color: var(--ops-accent-hover);
		border-color: var(--ops-accent);
	}

	.more {
		width: 100%;
		min-height: 44px;
		border-top: 1px solid var(--ops-divider) !important;
		color: var(--ops-accent);
		font-weight: 600;
	}

	.clear {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 18px 20px 22px;
		border-top: 1px solid var(--ops-divider);
	}

	.tick {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--ops-good-soft);
		color: var(--ops-good);
		flex-shrink: 0;
	}

	@media (max-width: 760px) {
		li {
			grid-template-columns: 24px minmax(0, 1fr);
			padding: 12px 14px;
		}

		.what,
		.acts {
			grid-column: 2;
		}

		.btn {
			min-height: 44px;
		}

		.head {
			padding: 14px 14px 8px;
		}
	}
</style>
