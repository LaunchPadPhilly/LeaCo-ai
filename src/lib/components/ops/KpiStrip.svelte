<script lang="ts">
	import { changeWords, fmt } from '$lib/leaco/ops/format';
	import type { Headline } from '$lib/leaco/ops/summary';

	let { h, endLabel, priorLabel }: { h: Headline; endLabel: string; priorLabel: string | null } = $props();

	type Tile = { label: string; help: string; value: string; unit?: string; sub: string | null; delta: number | null; note?: string };

	const tiles = $derived.by((): Tile[] => {
		const vsPrior = (d: number | null, dp = 0) => (d === null || !priorLabel ? null : `${changeWords(d, dp)} from ${priorLabel}`);
		const injNote =
			h.injectors && h.injectorRowsTaking !== h.injectors[0]
				? `Report header. The injector table shows ${h.injectorRowsTaking} with water going in.`
				: undefined;
		return [
			{
				label: 'Water injected',
				help: 'Barrels of water pushed underground. 1 barrel = 42 US gallons. Water is LeaCo’s main income.',
				value: fmt(h.water.value),
				unit: 'bbl',
				sub: h.single ? vsPrior(h.water.change) : `${fmt(h.water.perDay)} bbl/day average`,
				delta: h.single ? h.water.change : null
			},
			{
				label: 'Oil produced',
				help: 'Barrels of oil produced.',
				value: fmt(h.oil.value, 1),
				unit: 'bbl',
				sub: h.single ? vsPrior(h.oil.change, 1) : `${fmt(h.oil.perDay, 1)} bbl/day average`,
				delta: h.single ? h.oil.change : null
			},
			{
				label: 'Wells running',
				help: 'Producing wells the report lists as running.',
				value: h.wells ? `${h.wells[0]} / ${h.wells[1]}` : 'No data',
				sub: h.single ? vsPrior(h.wellsChange) : `on ${endLabel}`,
				delta: h.single ? h.wellsChange : null
			},
			{
				label: 'Injectors taking water',
				help: 'Injectors push water underground. Each one taking water is earning revenue.',
				value: h.injectors ? `${h.injectors[0]} / ${h.injectors[1]}` : 'No data',
				sub: h.single ? vsPrior(h.injectorsChange) : `on ${endLabel}`,
				delta: h.single ? h.injectorsChange : null,
				note: injNote
			}
		];
	});
</script>

<ul class="kpis" aria-label="Headline numbers">
	{#each tiles as t (t.label)}
		<li class="kpi">
			<span class="label" title={t.help}>{t.label}</span>
			<span class="value" class:none={t.value === 'No data'}>
				{t.value}{#if t.unit && t.value !== 'No data'}<small> {t.unit}</small>{/if}
			</span>
			{#if t.sub}
				<span class="sub" class:up={t.delta !== null && t.delta > 0} class:down={t.delta !== null && t.delta < 0}>
					{#if t.delta !== null && t.delta !== 0}<span aria-hidden="true">{t.delta > 0 ? '▲' : '▼'}</span>{/if}
					{t.sub}
				</span>
			{/if}
			{#if t.note}<span class="note">{t.note}</span>{/if}
		</li>
	{/each}
</ul>

<style>
	.kpis {
		display: grid;
		/* Four across on wide screens, two on phones. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
		gap: 8px;
	}

	.kpi {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		padding: 10px 12px;
		min-width: 0;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		color: var(--ops-muted);
		cursor: help;
		text-decoration: underline dotted rgb(95 102 109 / 45%);
		text-underline-offset: 3px;
		width: fit-content;
	}

	.value {
		font-size: clamp(24px, 2.4vw, 32px);
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.15;
	}

	.value small {
		margin-left: 0.25em;
		font-size: 13px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	.value.none {
		color: var(--ops-muted);
		font-size: 18px;
	}

	.sub {
		font-size: 12px;
		color: var(--ops-muted);
	}

	.sub.up {
		color: var(--ops-good);
	}

	.sub.down {
		color: var(--ops-danger);
	}

	.note {
		font-size: 11px;
		color: var(--ops-muted);
		border-top: 1px dashed var(--ops-line);
		padding-top: 4px;
		margin-top: 2px;
	}
</style>
