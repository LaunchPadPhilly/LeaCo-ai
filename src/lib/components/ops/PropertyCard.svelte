<script lang="ts">
	import { fmt } from '$lib/leaco/ops/format';
	import type { Period } from '$lib/leaco/ops/period';
	import type { Property } from '$lib/leaco/ops/properties';
	import { INJECTOR_STATUS, WELL_STATUS } from '$lib/leaco/ops/status';
	import type { AreaSummary } from '$lib/leaco/ops/summary';
	import Sparkline from './Sparkline.svelte';
	import StatusBar from './StatusBar.svelte';

	let {
		property,
		summary = null,
		period,
		periodText,
		endLabel,
		selected,
		onselect
	}: {
		property: Property;
		summary?: AreaSummary | null;
		period: Period;
		periodText: string;
		endLabel: string;
		selected: boolean;
		onselect: () => void;
	} = $props();

	const single = $derived(period.s === period.e);
	const share = (v: number | null) => (v === null ? 'no data' : `${v}%`);
	const role = $derived.by(() => {
		if (!summary) return null;
		if (property.key === 'mlmu') return `Water hub: took ${share(summary.waterShare)} of water injected · ${share(summary.oil30Share)} of 30-day oil`;
		if (property.key === 'eeu') return `Oil producer: ${share(summary.oil30Share)} of 30-day oil`;
		return `Small oil leases: ${share(summary.oil30Share)} of 30-day oil. XRI water enters here.`;
	});
</script>

<article class="pcard" class:selected aria-labelledby="prop-{property.key}">
	<button type="button" class="head" onclick={onselect} aria-pressed={selected} aria-label="Show {property.name} on the map">
		<span class="tag" class:land={property.kind === 'land'}>{property.kind === 'operating' ? 'Operating' : 'Land'}</span>
		<h3 id="prop-{property.key}">{property.name}</h3>
		<span class="near">{property.near}</span>
	</button>

	{#if summary}
		<p class="role">{role}</p>
		<dl class="kv">
			<div>
				<dt>Water, {periodText}</dt>
				<dd>{fmt(summary.water)} bbl{#if !single}<small>{fmt(summary.waterPerDay)}/day</small>{/if}</dd>
			</div>
			<div>
				<dt>Oil, {periodText}</dt>
				<dd>{fmt(summary.oil, 1)} bbl{#if !single}<small>{fmt(summary.oilPerDay, 1)}/day</small>{/if}</dd>
			</div>
			<div>
				<dt>Oil, 30 days to {endLabel}</dt>
				<dd>{fmt(summary.oil30)} bbl</dd>
			</div>
		</dl>
		<div class="sparks">
			<div><Sparkline values={summary.waterSeries} {period} color="var(--ops-water)" label="Water by day for {property.name}" /><span>water by day</span></div>
			<div><Sparkline values={summary.oilSeries} {period} color="var(--ops-oil)" label="Oil by day for {property.name}" /><span>oil by day</span></div>
		</div>

		{#if summary.wells.total}
			{@const w = summary.wells}
			<StatusBar
				label="Wells on {endLabel}"
				total={w.total}
				parts={[
					{ count: w.run, color: WELL_STATUS.run.color, name: 'running' },
					{ count: w.down, color: WELL_STATUS.down.color, name: 'down' },
					{ count: w.nodata + w.unk, color: WELL_STATUS.nodata.color, name: 'no data or not mentioned' }
				]}
			/>
			<p class="barlbl">
				<span>Wells on {endLabel}: <b>{w.run}</b> running · <b class:bad={w.down > 0}>{w.down}</b> down{#if w.nodata + w.unk}{' · '}{w.nodata + w.unk} not reported{/if}</span>
				<span>{w.total}</span>
			</p>
		{/if}
		{#if summary.injectors.total}
			{@const i = summary.injectors}
			<StatusBar
				label="Injectors"
				total={i.total}
				parts={[
					{ count: i.take, color: INJECTOR_STATUS.take.color, name: 'taking water' },
					{ count: i.stuck, color: INJECTOR_STATUS.stuck.color, name: 'stuck' },
					{ count: i.idle, color: INJECTOR_STATUS.idle.color, name: 'idle' },
					{ count: i.nodata, color: INJECTOR_STATUS.nodata.color, name: 'no reading' }
				]}
			/>
			<p class="barlbl">
				<span>Injectors: <b>{i.take}</b> took water{single ? '' : ' in period'}{#if i.stuck}{' · '}<b class="bad">{i.stuck} stuck</b>{/if}{#if i.nodata}{' · '}{i.nodata} no reading{/if}</span>
				<span>{i.total}</span>
			</p>
		{/if}
	{:else}
		<dl class="facts">
			{#each property.facts as [k, v] (k)}
				<div><dt>{k}</dt><dd>{v}</dd></div>
			{/each}
		</dl>
	{/if}

	{#if property.warn}<p class="warn">{property.warn}</p>{/if}
	<p class="src">Source: {property.source}</p>
</article>

<style>
	.pcard {
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		padding: 10px 12px 10px;
		display: grid;
		gap: 8px;
	}

	.pcard.selected {
		border-color: var(--ops-accent);
		box-shadow: 0 0 0 2px var(--ops-accent-soft);
	}

	.head {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 8px;
		align-items: baseline;
		text-align: left;
		width: 100%;
		min-height: 36px;
	}

	.head h3 {
		font-size: 15px;
		font-weight: 700;
	}

	.head:hover h3 {
		color: var(--ops-accent);
	}

	.near {
		grid-column: 2;
		font-size: 12px;
		color: var(--ops-muted);
	}

	.tag {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ops-accent);
		background: var(--ops-accent-soft);
		border-radius: 4px;
		padding: 2px 5px;
	}

	.tag.land {
		color: #7a5c1e;
		background: #f6eedc;
	}

	.role {
		font-size: 12.5px;
		color: var(--ops-muted);
	}

	.kv {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}

	.kv dt,
	.facts dt {
		font-size: 11px;
		color: var(--ops-muted);
	}

	.kv dd {
		font-size: 14px;
		font-weight: 700;
	}

	.kv small {
		display: block;
		font-size: 11px;
		font-weight: 500;
		color: var(--ops-muted);
	}

	.sparks {
		display: grid;
		gap: 2px;
	}

	.sparks div {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: var(--ops-muted);
	}

	.barlbl {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 12px;
		color: var(--ops-muted);
		margin-top: -4px;
	}

	.barlbl b {
		color: var(--ops-ink);
	}

	.barlbl .bad {
		color: var(--ops-danger);
	}

	.facts {
		display: grid;
		gap: 6px;
	}

	.facts dd {
		font-size: 13px;
	}

	.warn {
		font-size: 12px;
		color: #7a5c1e;
		background: #fbf4e4;
		border-radius: 6px;
		padding: 5px 8px;
	}

	.src {
		font-size: 11px;
		color: var(--ops-muted);
	}
</style>
