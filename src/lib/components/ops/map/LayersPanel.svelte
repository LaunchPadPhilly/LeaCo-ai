<script lang="ts">
	import { LAYER_GROUPS, VIEWS, allLayers, viewsOf, viewState, type LayerId, type LayerState, type LayerView } from '$lib/leaco/ops/layers';
	import { INJECTOR_STATUS, WELL_STATUS } from '$lib/leaco/ops/status';
	import AssetGlyph from './AssetGlyph.svelte';

	/**
	 * Turn map layers on and off (brief §3 "Layers panel"): quick sets, all on/off, and one
	 * checkbox per layer with its count, legend and source. The background map (Topo by
	 * default) is chosen in Settings → Map, not here.
	 */
	let {
		layers = $bindable(),
		counts
	}: {
		layers: LayerState;
		counts: Partial<Record<LayerId, number>>;
	} = $props();

	let open = $state(false);
	const activeViews = $derived(viewsOf(layers));
	const onCount = $derived(Object.values(layers).filter(Boolean).length);

	function toggle(id: LayerId, on: boolean) {
		layers = { ...layers, [id]: on };
	}
	function setView(v: LayerView) {
		layers = viewState(v);
	}

	export function close() {
		open = false;
	}
</script>

<div class="layers">
	<button type="button" class="toggle" aria-expanded={open} aria-controls="ops-layers-panel" onclick={() => (open = !open)}>
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 1 L15 4.5 L8 8 L1 4.5 Z" fill="none" stroke="currentColor" stroke-width="1.4" />
			<path d="M1 8 L8 11.5 L15 8" fill="none" stroke="currentColor" stroke-width="1.4" />
			<path d="M1 11.5 L8 15 L15 11.5" fill="none" stroke="currentColor" stroke-width="1.4" />
		</svg>
		Layers <span class="count">{onCount}</span>
	</button>

	{#if open}
		<div class="panel" id="ops-layers-panel" role="region" aria-label="Map layers">
			<p class="hint">Quick sets</p>
			<div class="seg" role="group" aria-label="Quick sets">
				{#each Object.entries(VIEWS) as [id, v] (id)}
					<button type="button" aria-pressed={activeViews.includes(id as LayerView)} onclick={() => setView(id as LayerView)}>{v.label}</button>
				{/each}
			</div>
			<div class="acts">
				<button type="button" onclick={() => (layers = allLayers(true))}>All on</button>
				<button type="button" onclick={() => (layers = allLayers(false))}>All off</button>
			</div>

			{#each LAYER_GROUPS as group (group.title)}
				<fieldset>
					<legend>{group.title}</legend>
					{#each group.layers as l (l.id)}
						<label class="layer">
							<input type="checkbox" checked={layers[l.id]} onchange={(e) => toggle(l.id, e.currentTarget.checked)} />
							<span class="sw" aria-hidden="true">
								{#if l.id === 'injectors'}
									<svg width="16" height="16" viewBox="-8 -8 16 16"><AssetGlyph kind="injector" style={INJECTOR_STATUS.take} /></svg>
								{:else if l.id === 'wells'}
									<svg width="16" height="16" viewBox="-8 -8 16 16"><AssetGlyph kind="well" style={WELL_STATUS.run} /></svg>
								{:else if l.id === 'areas'}
									<svg width="22" height="14"><rect x="1.5" y="1.5" width="19" height="11" rx="4" fill="#fff" stroke="#1b2127" stroke-dasharray="4 2" /></svg>
								{:else if l.id === 'dp'}
									<svg width="16" height="16"><circle cx="8" cy="8" r="5.5" fill="#fff" stroke="#dd6b20" stroke-width="2.4" /></svg>
								{:else if l.id === 'winkler'}
									<svg width="22" height="14"><rect x="1.5" y="1.5" width="19" height="11" fill="#fff" stroke="#1b2127" stroke-width="1.8" /></svg>
								{:else if l.id === 'crawford'}
									<svg width="22" height="14"><rect x="1.5" y="1.5" width="19" height="11" fill="#fff" stroke="#1b2127" stroke-width="1.8" stroke-dasharray="5 2" /></svg>
								{:else if l.id === 'routes'}
									<svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke="#fff" stroke-width="6" /><line x1="1" y1="5" x2="21" y2="5" stroke="#5b3cc4" stroke-width="3.4" /></svg>
								{:else if l.id === 'state'}
									<svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke="#3b3f45" stroke-width="2.4" stroke-dasharray="10 3 2 3" /></svg>
								{/if}
							</span>
							<span class="nm">
								{l.name}
								<small>{l.source}{#if l.confidence}<em> · {l.confidence}</em>{/if}</small>
							</span>
							<span class="ct">
								{counts[l.id] ?? ''}
							</span>
						</label>
						{#if l.id === 'injectors' && layers.injectors}
							<ul class="lg">
								{#each Object.entries(INJECTOR_STATUS) as [k, s] (k)}
									<li><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><AssetGlyph kind="injector" style={s} /></svg>{s.short}</li>
								{/each}
							</ul>
						{:else if l.id === 'wells' && layers.wells}
							<ul class="lg">
								{#each Object.entries(WELL_STATUS) as [k, s] (k)}
									<li><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><AssetGlyph kind="well" style={s} /></svg>{s.short}</li>
								{/each}
							</ul>
						{:else if l.id === 'routes' && layers.routes}
							<ul class="lg">
								<li><svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" stroke="#c53030" stroke-width="2.5" stroke-dasharray="4 3" /></svg>no mapped road (last stretch)</li>
							</ul>
						{/if}
					{/each}
				</fieldset>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Pinned to the map's top and bottom so the panel can never be taller than the map;
	   the panel scrolls inside that space. The empty part lets clicks through to the map. */
	.layers {
		position: absolute;
		top: 12px;
		right: 12px;
		bottom: 12px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		pointer-events: none;
	}

	.layers > * {
		pointer-events: auto;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 40px;
		padding: 0 12px;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 10px;
		box-shadow: var(--ops-shadow);
		font-weight: 600;
		font-size: 13px;
	}

	.toggle[aria-expanded='true'] {
		color: var(--ops-accent);
		border-color: var(--ops-accent);
	}

	.count {
		font-size: 11px;
		background: var(--ops-sunken);
		border-radius: 999px;
		padding: 1px 7px;
		color: var(--ops-muted);
	}

	.panel {
		width: 310px;
		max-width: calc(100vw - 24px);
		min-height: 0;
		flex: 0 1 auto;
		overflow-y: auto;
		/* Scrolling to the end of the list doesn't carry on into the page. */
		overscroll-behavior: contain;
		touch-action: pan-y;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 12px;
		box-shadow: var(--ops-shadow);
		padding: 10px 12px 12px;
		display: grid;
		align-content: start;
		gap: 8px;
	}

	.hint {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ops-muted);
	}

	.seg {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		background: var(--ops-sunken);
		border: 1px solid var(--ops-line);
		border-radius: 9px;
		padding: 3px;
	}

	.seg button {
		min-height: 32px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	.seg button[aria-pressed='true'] {
		background: var(--ops-panel);
		color: var(--ops-accent);
		box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
	}







	.acts {
		display: flex;
		gap: 6px;
	}

	.acts button {
		font-size: 12px;
		font-weight: 600;
		color: var(--ops-muted);
		border: 1px solid var(--ops-line);
		border-radius: 7px;
		padding: 4px 10px;
		min-height: 30px;
	}

	.acts button:hover {
		color: var(--ops-accent);
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 4px 0 0;
		border-top: 1px solid var(--ops-sunken);
		display: grid;
		gap: 1px;
	}

	legend {
		font-size: 11px;
		font-weight: 700;
		color: var(--ops-muted);
		padding: 2px 0 4px;
	}

	.layer {
		display: grid;
		grid-template-columns: 18px 24px 1fr auto;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 2px 4px;
		border-radius: 7px;
		cursor: pointer;
		font-size: 13px;
	}

	.layer:hover {
		background: var(--ops-sunken);
	}

	.layer input {
		width: 16px;
		height: 16px;
		accent-color: var(--ops-accent);
	}

	.sw {
		display: grid;
		place-items: center;
	}

	.nm {
		display: grid;
		line-height: 1.25;
	}

	.nm small {
		font-size: 10.5px;
		color: var(--ops-muted);
	}

	.nm em {
		font-style: normal;
		color: #8a6417;
	}

	.ct {
		font-size: 11px;
		color: var(--ops-muted);
	}

	.lg {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
		padding: 0 4px 6px 52px;
		font-size: 11.5px;
		color: var(--ops-muted);
	}

	.lg li {
		display: flex;
		align-items: center;
		gap: 4px;
	}
</style>
