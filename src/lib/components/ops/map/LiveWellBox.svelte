<script lang="ts">
	import { fmt } from '$lib/leaco/ops/format';
	import { agoText, isOffline, type LiveWell } from '$lib/leaco/ops/live';

	/** A well's live Amplified readings inside its detail drawer. */
	let {
		well,
		notLinked,
		syncedAt,
		now
	}: { well: LiveWell | null; notLinked: string | null; syncedAt: string | null; now: number } = $props();

	const statusColor = (s: LiveWell['status']) =>
		s === 'Running' ? 'var(--ops-good)' : s === 'Shutdown' ? 'var(--ops-danger)' : s === 'Idle' ? '#9a6b00' : 'var(--ops-muted)';
	const psi = (v: number | null) => (v === null ? 'No data' : `${fmt(v, 1)} psi`);
</script>

<section class="livebox" aria-labelledby="livebox-title">
	<h3 id="livebox-title">Live from Amplified{syncedAt ? ` · ${agoText(syncedAt, now)}` : ''}</h3>
	{#if well}
		<p class="status">
			Right now: <b style:color={statusColor(well.status)}>{well.status ?? 'No reading'}</b>
		</p>
		{#if isOffline(well, now)}
			<p class="offline">The device hasn’t checked in for over a day{well.lastConnection ? ` (last ${well.lastConnection} UTC)` : ''}, so this status may be out of date.</p>
		{/if}
		<table>
			<tbody>
				<tr><th scope="row">Runtime yesterday (Central time)</th><td>{well.runtimeYesterday === null ? 'No data' : `${fmt(well.runtimeYesterday, 1)}%`}</td></tr>
				<tr><th scope="row">Tubing pressure</th><td>{psi(well.tubingPressure)}</td></tr>
				<tr><th scope="row">Casing pressure</th><td>{psi(well.casingPressure)}</td></tr>
				<tr><th scope="row">Last check-in</th><td>{well.lastConnection ? `${well.lastConnection} UTC` : 'No data'}</td></tr>
			</tbody>
		</table>
		{#if well.tickets.length}
			<ul class="tickets">
				{#each well.tickets as t, i (t.id ?? i)}
					<li><b>{t.title}</b>{t.priority ? ` · ${t.priority}` : ''}{t.created ? ` · opened ${t.created.slice(0, 10)}` : ''}</li>
				{/each}
			</ul>
		{:else}
			<p class="fine">No open tickets.</p>
		{/if}
		<p class="fine">Amplified asset {well.customerAssetId}{well.amplifiedId !== null ? ` (#${well.amplifiedId})` : ''}.</p>
	{:else if notLinked}
		<p class="fine"><b>Not linked to Amplified yet.</b> {notLinked} See docs/leaco/amplified-findings.md.</p>
	{:else}
		<p class="fine">No live data synced yet.</p>
	{/if}
</section>

<style>
	.livebox {
		display: grid;
		gap: 6px;
		border: 1px solid var(--ops-line);
		border-left: 4px solid var(--ops-accent);
		border-radius: 10px;
		padding: 10px 12px;
	}

	h3 {
		font-size: 12.5px;
		font-weight: 700;
	}

	.status {
		font-size: 14px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}

	th {
		text-align: left;
		font-weight: 400;
		color: var(--ops-muted);
		padding: 3px 8px 3px 0;
		width: 55%;
	}

	td {
		padding: 3px 0;
		font-weight: 600;
	}

	.tickets {
		display: grid;
		gap: 4px;
		font-size: 12.5px;
		background: var(--ops-danger-soft);
		border-radius: 6px;
		padding: 6px 8px;
	}

	.offline {
		font-size: 12px;
		color: var(--ops-danger);
	}

	.fine {
		font-size: 11.5px;
		color: var(--ops-muted);
	}
</style>
