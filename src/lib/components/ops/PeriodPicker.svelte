<script lang="ts">
	import { clampPeriod, presetOf, presetPeriod, shortDay, type Period, type PeriodPreset } from '$lib/leaco/ops/period';

	let { dates, period = $bindable() }: { dates: string[]; period: Period } = $props();

	const presets: { id: PeriodPreset; label: string }[] = [
		{ id: 'day', label: 'Latest day' },
		{ id: '7', label: 'Last 7 days' },
		{ id: 'all', label: 'All reports' }
	];
	const active = $derived(presetOf(period, dates.length));

	function setFrom(i: number) {
		period = clampPeriod({ s: i, e: Math.max(i, period.e) }, dates.length);
	}
	function setTo(i: number) {
		period = clampPeriod({ s: Math.min(i, period.s), e: i }, dates.length);
	}
</script>

<fieldset class="period">
	<legend class="ops-eyebrow">Time period</legend>
	<div class="seg" role="group" aria-label="Quick periods">
		{#each presets as p (p.id)}
			<button type="button" aria-pressed={active === p.id} onclick={() => (period = presetPeriod(p.id, dates.length))}>
				{p.label}
			</button>
		{/each}
	</div>
	<div class="range">
		<label>
			<span>From</span>
			<select value={period.s} onchange={(e) => setFrom(+e.currentTarget.value)}>
				{#each dates as d, i (d)}<option value={i}>{shortDay(d)}</option>{/each}
			</select>
		</label>
		<label>
			<span>to</span>
			<select value={period.e} onchange={(e) => setTo(+e.currentTarget.value)}>
				{#each dates as d, i (d)}<option value={i}>{shortDay(d)}</option>{/each}
			</select>
		</label>
	</div>
</fieldset>

<style>
	.period {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 8px;
	}

	.seg {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		background: var(--ops-sunken);
		border: 1px solid var(--ops-line);
		border-radius: 10px;
		padding: 3px;
	}

	.seg button {
		min-height: 36px;
		border-radius: 7px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	.seg button[aria-pressed='true'] {
		background: var(--ops-panel);
		color: var(--ops-accent);
		box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
	}

	.range {
		display: flex;
		gap: 10px;
		font-size: 13px;
		color: var(--ops-muted);
	}

	.range label {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.range select {
		min-height: 32px;
		border: 1px solid var(--ops-line);
		border-radius: 7px;
		background: var(--ops-panel);
		padding: 2px 6px;
		color: var(--ops-ink);
		font-weight: 600;
	}
</style>
