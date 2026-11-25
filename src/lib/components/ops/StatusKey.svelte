<script lang="ts">
	import { INJECTOR_STATUS, WELL_STATUS } from '$lib/leaco/ops/status';
	import AssetGlyph from './map/AssetGlyph.svelte';

	/**
	 * The status key, in place (DESIGN.md → Status): every shape and what it means, and where
	 * the status comes from. The same symbols as the map and the lists, so learning them here
	 * teaches the whole app.
	 */
	let open = $state(false);
	let root: HTMLElement | undefined = $state();

	const wells = [
		{ style: WELL_STATUS.run, text: 'Running', note: 'Pumping. Nothing to do.' },
		{ style: WELL_STATUS.idle, text: 'Idle', note: 'Not pumping right now; often a timer.' },
		{ style: WELL_STATUS.down, text: 'Shut down', note: 'Stopped. Shows under “Needs a contractor”.' },
		{ style: WELL_STATUS.nodata, text: 'No reading', note: 'Amplified has no status. Never guessed.' }
	];
	const injectors = [
		{ style: INJECTOR_STATUS.take, text: 'Taking water', note: 'Took water on the report day.' },
		{ style: INJECTOR_STATUS.stuck, text: 'Not taking water', note: 'Pressure but 0 bbl. Needs a look.' },
		{ style: INJECTOR_STATUS.idle, text: 'Idle', note: 'Listed idle in the report.' },
		{ style: INJECTOR_STATUS.nodata, text: 'No volume reading', note: 'The report has no number for it.' }
	];

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false;
			root?.querySelector('button')?.focus();
		}
	}
	function onDocClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
</script>

<svelte:document onclick={onDocClick} />

<div class="key" bind:this={root}>
	<button type="button" class="toggle" aria-expanded={open} aria-controls="status-key-panel" onclick={() => (open = !open)} onkeydown={onKey}>
		<span class="q" aria-hidden="true">?</span>
		What the shapes mean
	</button>
	{#if open}
		<div id="status-key-panel" class="panel" role="dialog" aria-label="Status key" tabindex="-1" onkeydown={onKey}>
			<p class="cap">Producing wells ● · status from Amplified</p>
			<ul>
				{#each wells as row (row.text)}
					<li>
						<svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden="true"><g transform="scale(1.7)"><AssetGlyph kind="well" style={row.style} /></g></svg>
						<span><b>{row.text}</b><span class="note">{row.note}</span></span>
					</li>
				{/each}
				<li>
					<span class="sym offline" aria-hidden="true">?</span>
					<span><b>Offline</b><span class="note">No check-in for a day; status may be old.</span></span>
				</li>
			</ul>
			<p class="cap">Injectors ▲ · status from the daily reports</p>
			<ul>
				{#each injectors as row (row.text)}
					<li>
						<svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden="true"><g transform="scale(1.4)"><AssetGlyph kind="injector" style={row.style} /></g></svg>
						<span><b>{row.text}</b><span class="note">{row.note}</span></span>
					</li>
				{/each}
			</ul>
			<p class="cap">Elsewhere</p>
			<ul>
				<li>
					<span class="sym ticket" aria-hidden="true">!</span>
					<span><b>Open ticket</b><span class="note">From Amplified; the well may still run.</span></span>
				</li>
				<li>
					<span class="sym hatch" aria-hidden="true"></span>
					<span><b>No data</b><span class="note">A missing day. Gaps stay gaps; nothing is filled in.</span></span>
				</li>
			</ul>
		</div>
	{/if}
</div>

<style>
	.key {
		position: relative;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 12px;
		border: 1px solid var(--ops-line) !important;
		border-radius: 8px;
		background: var(--ops-panel) !important;
		font-size: 14px;
		font-weight: 600;
		color: var(--ops-ink-2);
		white-space: nowrap;
	}

	.toggle[aria-expanded='true'] {
		border-color: var(--ops-accent) !important;
		color: var(--ops-accent);
	}

	.q {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--ops-accent);
		color: #fff;
		font-size: 12px;
		font-weight: 700;
	}

	.panel {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 40;
		width: min(340px, calc(100vw - 32px));
		max-height: min(70vh, 560px);
		overflow-y: auto;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 12px;
		padding: 12px 14px;
		box-shadow: var(--ops-shadow-float);
	}

	.cap {
		margin-top: 8px;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ops-muted);
	}

	.cap:first-child {
		margin-top: 0;
	}

	ul {
		display: grid;
		gap: 2px;
		margin: 4px 0 2px;
	}

	li {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 8px;
		align-items: center;
		padding: 4px 0;
		font-size: 13.5px;
	}

	.note {
		display: block;
		font-size: 12.5px;
		color: var(--ops-muted);
	}

	.sym {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin: 0 auto;
		color: #fff;
		font-weight: 700;
		font-size: 12px;
	}

	.sym.offline {
		border-radius: 50%;
		background: var(--ops-offline);
	}

	.sym.ticket {
		border-radius: 5px;
		background: var(--ops-warn-fill);
	}

	.sym.hatch {
		width: 12px;
		height: 24px;
		border: 1px dashed var(--ops-offline);
		background: var(--ops-hatch);
	}
</style>
