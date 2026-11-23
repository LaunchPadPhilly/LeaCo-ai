<script lang="ts">
	import { volumeText, pressureText } from '$lib/leaco/ops/assetText';
	import { fmt } from '$lib/leaco/ops/format';
	import { inPeriod, shortDay, type Period } from '$lib/leaco/ops/period';
	import type { AssetDay } from '$lib/leaco/ops/types';

	/** Daily volume bars (blue) and pressure dots (orange), selected period shaded. */
	let { days, dates, period }: { days: AssetDay[]; dates: string[]; period: Period } = $props();

	const W = 320;
	const H = 96;
	const PAD = 16;
	const geo = $derived.by(() => {
		const vols = days.map((d) => (d.volumeSource === 'reading' ? (d.volume ?? 0) : 0));
		const psis = days.map((d) => d.pressure).filter((p): p is number => p !== null);
		const maxV = Math.max(...vols, 1);
		const maxP = Math.max(...psis, 1);
		const bw = (W - PAD * 2) / days.length;
		return { maxV, maxP, bw };
	});
</script>

<figure class="chart">
	<svg width="100%" viewBox="0 0 {W} {H + 18}" role="img" aria-label="Daily injection volume and pressure, {shortDay(dates[0])} to {shortDay(dates[dates.length - 1])}">
		<rect x={PAD + period.s * geo.bw} y="12" width={(period.e - period.s + 1) * geo.bw} height={H - 12} fill="var(--ops-water)" opacity="0.07" />
		{#each days as d, i (i)}
			{@const reading = d.volumeSource === 'reading' && d.volume !== null}
			{@const bh = reading ? ((d.volume ?? 0) / geo.maxV) * (H - 16) : 0}
			{@const x = PAD + i * geo.bw}
			{@const dim = !inPeriod(i, period)}
			<g opacity={dim ? 0.35 : 1}>
				<title>{shortDay(dates[i])}: {volumeText(d)}{d.pressure !== null ? ` · ${fmt(d.pressure)} psi` : ''}</title>
				{#if reading}
					<rect x={x + 1} y={H - Math.max(bh, d.volume! > 0 ? 1 : 0)} width={geo.bw - 2} height={Math.max(bh, d.volume! > 0 ? 1 : 0)} fill="var(--ops-water)" />
				{:else if d.volumeSource === 'no-reading'}
					<rect x={x + 1} y={H - 6} width={geo.bw - 2} height="6" fill="none" stroke="#9AA0A6" stroke-dasharray="2 2" />
				{/if}
				{#if d.pressure !== null}
					<circle cx={x + geo.bw / 2} cy={H - (d.pressure / geo.maxP) * (H - 16)} r="2.6" fill="#E8590C" />
				{/if}
			</g>
		{/each}
		<text x={PAD} y="9" font-size="9.5" fill="var(--ops-water)">bars: bbl (max {fmt(geo.maxV)})</text>
		<text x={W - PAD} y="9" font-size="9.5" fill="#B5470A" text-anchor="end">dots: psi (max {fmt(geo.maxP)})</text>
		<text x={PAD} y={H + 13} font-size="9.5" fill="var(--ops-muted)">{shortDay(dates[0])}</text>
		<text x={W - PAD} y={H + 13} font-size="9.5" fill="var(--ops-muted)" text-anchor="end">{shortDay(dates[dates.length - 1])}</text>
	</svg>
	<figcaption class="ops-sr">Bars are barrels injected per day; dashed boxes are days with no reading; dots are average pressure.</figcaption>
</figure>

<table class="days">
	<caption class="ops-sr">Injection by day</caption>
	<thead><tr><th scope="col">Day</th><th scope="col">Volume</th><th scope="col">Pressure</th></tr></thead>
	<tbody>
		{#each days.map((d, i) => ({ d, i })).reverse() as { d, i } (i)}
			<tr class:dim={!inPeriod(i, period)}>
				<td>{shortDay(dates[i])}</td>
				<td>{volumeText(d)}</td>
				<td>{pressureText(d)}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.chart {
		margin: 0;
	}

	.days {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}

	.days th {
		text-align: left;
		font-weight: 600;
		color: var(--ops-muted);
		border-bottom: 1px solid var(--ops-line);
		padding: 3px 4px;
	}

	.days td {
		padding: 3px 4px;
		border-bottom: 1px solid var(--ops-sunken);
		font-weight: 600;
	}

	.days tr.dim td {
		font-weight: 400;
		color: var(--ops-muted);
	}
</style>
