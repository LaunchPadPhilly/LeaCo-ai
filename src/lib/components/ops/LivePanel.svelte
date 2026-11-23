<script lang="ts">
	import { changeWords, fmt } from '$lib/leaco/ops/format';
	import { agoText, isOffline, type LiveSnapshot, type LiveState, type LiveWell } from '$lib/leaco/ops/live';
	import { shortDay } from '$lib/leaco/ops/period';
	import { WELL_STATUS } from '$lib/leaco/ops/status';
	import StatusBar from './StatusBar.svelte';

	/**
	 * The most current picture, straight from Amplified: live well status, the lease ledger's last
	 * complete day, and open tickets. Labelled with its source and age; nothing here is mixed into
	 * the daily-report numbers below.
	 */
	let {
		live,
		refreshing,
		now,
		nameOf,
		onrefresh,
		onpick
	}: {
		live: LiveState;
		refreshing: boolean;
		now: number;
		nameOf: (key: string) => string;
		onrefresh: () => void;
		onpick: (key: string) => void;
	} = $props();

	const snap = $derived<LiveSnapshot | null>(live.status === 'ok' ? live.snapshot : live.status === 'error' ? live.snapshot : null);

	const wells = $derived(snap ? Object.values(snap.wells) : []);
	const count = (s: LiveWell['status']) => wells.filter((w) => w.status === s).length;
	const shutdown = $derived(wells.filter((w) => w.status === 'Shutdown').sort((a, b) => nameOf(a.key).localeCompare(nameOf(b.key))));
	const offline = $derived(wells.filter((w) => w.status !== null && isOffline(w, now)));
	const ticketRows = $derived(wells.flatMap((w) => w.tickets.map((t) => ({ w, t }))));

	/** Totals for the last complete UTC day any lease reported, and the day before. */
	const ledger = $derived.by(() => {
		if (!snap) return null;
		const days = [...new Set(snap.leases.flatMap((l) => l.days.map((d) => d.day)))].sort();
		const total = (day: string | undefined, f: 'oil' | 'water') => {
			if (!day) return { sum: null as number | null, reporting: 0 };
			let sum = 0;
			let reporting = 0;
			for (const l of snap.leases) {
				const v = l.days.find((d) => d.day === day)?.[f];
				if (v === null || v === undefined) continue;
				sum += v;
				reporting++;
			}
			return { sum: reporting ? sum : null, reporting };
		};
		const day = days.at(-1);
		const prev = days.at(-2);
		const oil = total(day, 'oil');
		const water = total(day, 'water');
		const oilPrev = total(prev, 'oil').sum;
		const waterPrev = total(prev, 'water').sum;
		return {
			day,
			prev,
			oil,
			water,
			oilChange: oil.sum !== null && oilPrev !== null ? oil.sum - oilPrev : null,
			waterChange: water.sum !== null && waterPrev !== null ? water.sum - waterPrev : null,
			leases: snap.leases.length
		};
	});
</script>

<section class="live" aria-labelledby="live-title">
	<div class="head">
		<div>
			<h2 id="live-title" class="ops-eyebrow"><span class="dot" class:on={live.status === 'ok'} aria-hidden="true"></span>Live from Amplified</h2>
			{#if snap}
				<p class="when">
					Synced <b>{agoText(snap.syncedAt, now)}</b>
					({new Date(snap.syncedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}). Refreshes automatically every 15 minutes.
				</p>
			{/if}
		</div>
		<button type="button" class="refresh" onclick={onrefresh} disabled={refreshing || live.status === 'none'} aria-busy={refreshing}>
			{refreshing ? 'Refreshing…' : 'Refresh now'}
		</button>
	</div>

	{#if live.status === 'error'}
		<p class="msg bad" role="alert">Couldn’t refresh from Amplified: {live.reason}{snap ? ` Showing data from ${agoText(snap.syncedAt, now)}.` : ''}</p>
	{:else if live.status === 'none'}
		<p class="msg">{live.reason}</p>
	{/if}

	{#if snap}
		<div class="tiles">
			<div class="tile">
				<span class="label">Wells right now</span>
				<span class="value">{count('Running')} <small>running</small></span>
				<StatusBar
					label="Wells right now"
					total={wells.length}
					parts={[
						{ count: count('Running'), color: WELL_STATUS.run.color, name: 'running' },
						{ count: count('Idle'), color: '#E0A526', name: 'idle' },
						{ count: count('Shutdown'), color: WELL_STATUS.down.color, name: 'shut down' },
						{ count: count(null), color: WELL_STATUS.nodata.color, name: 'no reading' }
					]}
				/>
				<span class="sub">{count('Idle')} idle · <b class:bad={count('Shutdown') > 0}>{count('Shutdown')} shut down</b> · {count(null)} no reading · of {wells.length} linked</span>
				{#if offline.length}<span class="sub bad">{offline.length} of these haven’t checked in for over a day, so their status may be out of date.</span>{/if}
				<span class="note">Idle can be normal for wells on timers. {Object.keys(snap.notLinked).length} wells aren’t linked to Amplified yet.</span>
			</div>

			{#if ledger}
				<div class="tile">
					<span class="label">Oil produced{ledger.day ? `, ${shortDay(ledger.day)}` : ''}</span>
					<span class="value">{fmt(ledger.oil.sum, 1)}{#if ledger.oil.sum !== null}<small> bbl</small>{/if}</span>
					{#if ledger.oilChange !== null && ledger.prev}<span class="sub" class:up={ledger.oilChange > 0} class:down={ledger.oilChange < 0}>{changeWords(ledger.oilChange, 1)} from {shortDay(ledger.prev)}</span>{/if}
					<span class="note">Amplified lease ledger, UTC day · {ledger.oil.reporting} of {ledger.leases} leases reported</span>
				</div>
				<div class="tile">
					<span class="label">Produced water{ledger.day ? `, ${shortDay(ledger.day)}` : ''}</span>
					<span class="value">{fmt(ledger.water.sum)}{#if ledger.water.sum !== null}<small> bbl</small>{/if}</span>
					{#if ledger.waterChange !== null && ledger.prev}<span class="sub">{changeWords(ledger.waterChange)} from {shortDay(ledger.prev)}</span>{/if}
					<span class="note">LeaCo’s own produced water, not water injected (Amplified doesn’t report injection)</span>
				</div>
			{/if}

			<div class="tile">
				<span class="label">Open tickets</span>
				<span class="value">{ticketRows.length}</span>
				{#if ticketRows.length}
					<ul class="tickets">
						{#each ticketRows.slice(0, 4) as { w, t }, i (i)}
							<li><button type="button" onclick={() => onpick(w.key)}><b>{t.title}</b> · {nameOf(w.key)}{t.priority ? ` · ${t.priority}` : ''}</button></li>
						{/each}
					</ul>
				{:else}
					<span class="note">No open tickets on linked wells.</span>
				{/if}
			</div>
		</div>

		{#if shutdown.length}
			<details class="shut">
				<summary>Shut down right now ({shutdown.length})</summary>
				<ul>
					{#each shutdown as w (w.key)}
						<li>
							<button type="button" onclick={() => onpick(w.key)}>
								<span>{nameOf(w.key)}</span>
								<small class:bad={isOffline(w, now)}>{w.runtimeYesterday === null ? 'runtime n/a' : `ran ${fmt(w.runtimeYesterday, 0)}% yesterday`} · {isOffline(w, now) ? (w.lastConnection ? `device offline since ${w.lastConnection.slice(5, 16)} UTC; status may be old` : 'device has never checked in; status may be old') : `checked in ${w.lastConnection?.slice(11, 16)} UTC`}</small>
							</button>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
		{#if snap.warnings.length}
			<p class="msg">Some Amplified data came back with errors ({snap.warnings.length}); those values show as “No data”.</p>
		{/if}
	{/if}
</section>

<style>
	.live {
		display: grid;
		gap: 10px;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-left: 4px solid var(--ops-accent);
		border-radius: var(--ops-radius);
		padding: 12px 14px;
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		flex-wrap: wrap;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #9aa0a6;
		margin-right: 6px;
		vertical-align: 1px;
	}

	.dot.on {
		background: var(--ops-good);
	}

	.when {
		font-size: 12.5px;
		color: var(--ops-muted);
	}

	.when b {
		color: var(--ops-ink);
	}

	.refresh {
		min-height: 36px;
		padding: 0 14px;
		border: 1px solid var(--ops-accent);
		border-radius: 9px;
		color: var(--ops-accent);
		font-weight: 600;
		font-size: 13px;
	}

	.refresh:hover:not(:disabled) {
		background: var(--ops-accent-soft);
	}

	.refresh:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.msg {
		font-size: 12.5px;
		color: var(--ops-muted);
	}

	.msg.bad {
		color: var(--ops-danger);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
		gap: 10px;
	}

	.tile {
		display: grid;
		align-content: start;
		gap: 4px;
		background: var(--ops-sunken);
		border-radius: 8px;
		padding: 10px 12px;
		min-width: 0;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	.value {
		font-size: 26px;
		font-weight: 700;
		line-height: 1.1;
	}

	.value small {
		margin-left: 0.25em;
		font-size: 13px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	.sub {
		font-size: 12px;
		color: var(--ops-muted);
	}

	.sub b {
		font-weight: 600;
	}

	.sub .bad,
	.sub.down {
		color: var(--ops-danger);
	}

	.sub.up {
		color: var(--ops-good);
	}

	.note {
		font-size: 11px;
		color: var(--ops-muted);
	}

	.tickets {
		display: grid;
		gap: 2px;
		font-size: 12px;
	}

	.tickets button,
	.shut button {
		text-align: left;
		width: 100%;
		padding: 4px 6px;
		border-radius: 6px;
	}

	.tickets button:hover,
	.shut button:hover {
		background: var(--ops-panel);
	}

	.shut summary {
		cursor: pointer;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ops-danger);
		width: fit-content;
	}

	.shut ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
		gap: 2px 12px;
		margin-top: 6px;
	}

	.shut button {
		display: grid;
		min-height: 40px;
	}

	.shut span {
		font-size: 13px;
		font-weight: 600;
	}

	.shut small {
		font-size: 11.5px;
		color: var(--ops-muted);
	}

	.shut small.bad {
		color: var(--ops-danger);
	}
</style>
