<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { LIVE_STALE_MS, type LiveSnapshot, type LiveState } from '$lib/leaco/ops/live';
	import { opsFromAmplified, referenceNotInAmplified } from '$lib/leaco/ops/fromAmplified';
	import LivePanel from './LivePanel.svelte';
	import type { FeatureInfo } from '$lib/leaco/ops/feature';
	import { fmt } from '$lib/leaco/ops/format';
	import { clampPeriod, longDay, periodLabel, presetPeriod, shortDay, type Period } from '$lib/leaco/ops/period';
	import { AREA_KEYS, PROPERTIES, PROPERTY_KEYS } from '$lib/leaco/ops/properties';
	import { areaSummary, attention, headline } from '$lib/leaco/ops/summary';
	import type { AreaKey, OpsData, PropertyKey } from '$lib/leaco/ops/types';
	import AttentionList from './AttentionList.svelte';
	import KpiStrip from './KpiStrip.svelte';
	import PeriodPicker from './PeriodPicker.svelte';
	import PropertyCard from './PropertyCard.svelte';
	import TrendChart from './TrendChart.svelte';
	import AssetDetail from './map/AssetDetail.svelte';
	import FeatureDetail from './map/FeatureDetail.svelte';
	import OpsMap from './map/OpsMap.svelte';

	let { ops: serverOps, live: initialLive }: { ops: OpsData; live: LiveState } = $props();
	const amplifiedMode = $derived(serverOps.mode === 'amplified');

	// ---------- live Amplified data: shown at once from the saved copy, refreshed in the background
	let live = $state<LiveState>(untrack(() => initialLive));
	let refreshing = $state(false);
	let now = $state(Date.now());
	const liveSnap = $derived<LiveSnapshot | null>(live.status === 'ok' ? live.snapshot : live.status === 'error' ? live.snapshot : null);

	async function refreshLive() {
		if (refreshing) return;
		refreshing = true;
		try {
			const res = await fetch('/dashboard/amplified', { method: 'POST' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			live = (await res.json()) as LiveState;
		} catch {
			live = { status: 'error', reason: 'The dashboard server could not be reached.', snapshot: liveSnap };
		} finally {
			refreshing = false;
			now = Date.now();
		}
	}

	onMount(() => {
		const stale = !liveSnap || Date.now() - Date.parse(liveSnap.syncedAt) > LIVE_STALE_MS;
		const keyMissing = live.status === 'none' && /not set/.test(live.reason);
		if (stale && !keyMissing) void refreshLive();
		const tick = setInterval(() => (now = Date.now()), 30_000);
		const resync = setInterval(() => {
			if (!keyMissing) void refreshLive();
		}, LIVE_STALE_MS);
		return () => {
			clearInterval(tick);
			clearInterval(resync);
		};
	});

	// In Amplified mode the whole view is rebuilt from each live refresh, so every number stays
	// current; in report mode it's the server's report data and the live panel sits on top.
	const ops = $derived<OpsData>(serverOps.mode === 'amplified' && liveSnap ? opsFromAmplified(liveSnap) : serverOps);
	const notOnMap = $derived(ops.assets.filter((a) => a.lat === null || a.lon === null));
	const notInAmplified = $derived(amplifiedMode && liveSnap ? referenceNotInAmplified(liveSnap) : []);

	// Starts on the latest day once per page load; the user changes it from there.
	let period = $state<Period>(presetPeriod('day', untrack(() => serverOps.dates.length)));
	// A refresh can add a new ledger day: keep the period inside the dates.
	$effect(() => {
		const n = ops.dates.length;
		untrack(() => {
			period = period.e >= n ? presetPeriod('day', n) : clampPeriod(period, n);
		});
	});
	let selectedProperty = $state<PropertyKey | null>(null);
	let selectedAsset = $state<string | null>(null);
	/** A clicked road, route or gap. Only one detail drawer is open at a time. */
	let feature = $state<FeatureInfo | null>(null);
	let map: OpsMap | undefined = $state();
	let mapSection: HTMLElement | undefined = $state();

	const dates = $derived(ops.dates);
	const pText = $derived(periodLabel(dates, period));
	const endLabel = $derived(shortDay(dates[period.e]));
	const priorLabel = $derived(period.e > 0 ? shortDay(dates[period.e - 1]) : null);
	const h = $derived(headline(ops, period));
	const summaries = $derived(Object.fromEntries(AREA_KEYS.map((k) => [k, areaSummary(ops, k, period)])) as Record<AreaKey, ReturnType<typeof areaSummary>>);
	const focusArea = $derived(selectedProperty && PROPERTIES[selectedProperty].kind === 'operating' ? (selectedProperty as AreaKey) : null);
	const items = $derived(selectedProperty && !focusArea ? [] : attention(ops, period, focusArea, (i) => shortDay(dates[i])));
	const asset = $derived(selectedAsset ? (ops.assets.find((a) => a.key === selectedAsset) ?? null) : null);
	const check = $derived(ops.reconciliation[dates[period.e]] ?? null);

	const wells = $derived(ops.totals.map((t) => t.wellsRunning?.[0] ?? null));
	const injectors = $derived(ops.totals.map((t) => t.injectorsTaking?.[0] ?? null));
	const wellTotal = $derived(Math.max(...ops.totals.map((t) => t.wellsRunning?.[1] ?? 0)));
	const injTotal = $derived(Math.max(...ops.totals.map((t) => t.injectorsTaking?.[1] ?? 0)));

	/** The map is below the fold: bring it into view when something on top points at it. */
	function showMap() {
		mapSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	function pickProperty(key: PropertyKey | null, scroll = false) {
		selectedProperty = key;
		if (key) map?.focusProperty(key);
		if (key && scroll) showMap();
	}
	function pickAsset(key: string | null, zoom = false) {
		selectedAsset = key;
		feature = null;
		if (key && zoom) {
			map?.focusAsset(key);
			showMap();
		}
	}
	const pickDay = (i: number) => (period = { s: i, e: i });
</script>

<div class="ops dash">
	<header class="top">
		<div class="brand">
			<p class="ops-eyebrow">LeaCo Operations</p>
			<h1>Field sheet</h1>
			<p class="asof">
				{amplifiedMode ? 'Latest Amplified production day' : 'Latest report'} <b>{longDay(dates[dates.length - 1])}</b> · showing <b>{pText}</b> ({period.e - period.s + 1} day{period.e > period.s ? 's' : ''})
			</p>
		</div>
		<div class="picker"><PeriodPicker {dates} bind:period /></div>
	</header>

	<main class="body">
		<LivePanel {live} {refreshing} {now} nameOf={(key) => ops.assets.find((a) => a.key === key)?.name ?? key} onrefresh={refreshLive} onpick={(key) => pickAsset(key, true)} />

		{#if amplifiedMode}
			<section class="source" aria-labelledby="source-title">
				<h2 id="source-title" class="ops-eyebrow">Where this data comes from</h2>
				<p>
					Everything on this page comes from the <b>Amplified API</b>, refreshed every 15 minutes. Well locations, API
					numbers and operators come from <b>NM OCD state records</b> where a well is linked to one.
				</p>
				<p>
					<b>Missing here</b>, because Amplified doesn’t provide it: water injected and injector volumes (LeaCo’s XRI
					water), day-by-day well status (Amplified gives the current status only), and daily-report notes.
				</p>
				{#if notOnMap.length}
					<details>
						<summary>{notOnMap.length} Amplified well{notOnMap.length > 1 ? 's have' : ' has'} no location and {notOnMap.length > 1 ? 'aren’t' : 'isn’t'} on the map</summary>
						<ul>
							{#each notOnMap as a (a.key)}
								<li><button type="button" class="linkish" onclick={() => pickAsset(a.key)}>{a.name}</button> <span class="ops-muted">({a.customerId})</span></li>
							{/each}
						</ul>
					</details>
				{/if}
				{#if notInAmplified.length}
					<details>
						<summary>{notInAmplified.length} state-record well{notInAmplified.length > 1 ? 's aren’t' : ' isn’t'} matched in Amplified</summary>
						<ul>
							{#each notInAmplified as w (w.key)}<li>{w.name}: <span class="ops-muted">{w.reason}</span></li>{/each}
						</ul>
					</details>
				{/if}
			</section>
		{:else}
		<section aria-labelledby="kpi-title" class="block">
			<h2 id="kpi-title" class="ops-eyebrow">From the daily reports · {pText}</h2>
			<KpiStrip {h} {endLabel} priorLabel={h.single ? priorLabel : null} />
			{#if check === 'mismatch'}
				<p class="check bad" role="alert">The {endLabel} report’s rows don’t add up to its total. Its numbers need checking with LeaCo.</p>
			{:else if check === 'rounding'}
				<p class="check">The {endLabel} report’s rows add up to within a few barrels of its total. That’s normal rounding.</p>
			{/if}
		</section>
		{/if}

		<section aria-labelledby="trends-title" class="block">
			<div class="block-head">
				<h2 id="trends-title" class="ops-eyebrow">Day by day · {amplifiedMode ? `last ${dates.length} days (Amplified lease ledger, UTC days)` : `all ${dates.length} reports`}</h2>
				<p class="hint">Shaded = selected period. Click a day to show just that day.</p>
			</div>
			{#if amplifiedMode}
				<div class="trends">
					<TrendChart title="Oil produced" subtitle="barrels per day, all leases" values={ops.totals.map((t) => t.oil)} {dates} {period} color="var(--ops-oil)" format={(v) => fmt(v, 1)} onpick={pickDay} />
					<TrendChart title="Produced water" subtitle="barrels per day, LeaCo’s own produced water" values={ops.totals.map((t) => t.producedWater ?? null)} {dates} {period} color="#5B7C99" format={(v) => fmt(v)} onpick={pickDay} />
					<div class="missing-card">
						<b>Water injected · Wells running · Injectors taking water</b>
						<p>Missing: Amplified has no injection data and no day-by-day well status. Current well status is in the live panel above.</p>
					</div>
				</div>
			{:else}
			<div class="trends">
				<TrendChart title="Water injected" subtitle="barrels per day" values={ops.totals.map((t) => t.water)} {dates} {period} color="var(--ops-water)" format={(v) => fmt(v)} onpick={pickDay} />
				<TrendChart title="Oil produced" subtitle="barrels per day" values={ops.totals.map((t) => t.oil)} {dates} {period} color="var(--ops-oil)" format={(v) => fmt(v, 1)} onpick={pickDay} />
				<TrendChart title="Wells running" subtitle="of {wellTotal} producing wells (report header)" values={wells} {dates} {period} kind="line" yMax={wellTotal} color="#2E8B3E" format={(v) => fmt(v)} onpick={pickDay} />
				<TrendChart title="Injectors taking water" subtitle="of {injTotal} injectors (report header)" values={injectors} {dates} {period} kind="line" yMax={injTotal} color="var(--ops-water)" format={(v) => fmt(v)} onpick={pickDay} />
			</div>
			{/if}
			<details class="table-view">
				<summary>Show these numbers as a table</summary>
				<div class="table-scroll">
					<table>
						<caption class="ops-sr">Daily totals</caption>
						<thead>
							<tr><th scope="col">Day</th><th scope="col">{amplifiedMode ? 'Produced water (bbl)' : 'Water injected (bbl)'}</th><th scope="col">Oil (bbl)</th><th scope="col">Wells running</th><th scope="col">Injectors taking water</th></tr>
						</thead>
						<tbody>
							{#each ops.totals.map((t, i) => ({ t, i })).reverse() as { t, i } (i)}
								<tr class:sel={i >= period.s && i <= period.e}>
									<th scope="row">{shortDay(dates[i])}</th>
									<td>{fmt(amplifiedMode ? (t.producedWater ?? null) : t.water)}</td>
									<td>{fmt(t.oil, 1)}</td>
									<td>{t.wellsRunning ? `${t.wellsRunning[0]} / ${t.wellsRunning[1]}` : 'No data'}</td>
									<td>{t.injectorsTaking ? `${t.injectorsTaking[0]} / ${t.injectorsTaking[1]}` : 'No data'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</section>

		<div class="split">
			<section aria-labelledby="props-title" class="block">
				<h2 id="props-title" class="ops-eyebrow">Properties · click one to see it on the map</h2>
				<div class="props">
					{#each PROPERTY_KEYS as key (key)}
						<PropertyCard
							property={PROPERTIES[key]}
							summary={PROPERTIES[key].kind === 'operating' ? summaries[key as AreaKey] : null}
							{period}
							periodText={pText}
							{endLabel}
							selected={selectedProperty === key}
							statusNow={amplifiedMode}
							onselect={() => pickProperty(selectedProperty === key ? null : key, true)}
						/>
					{/each}
				</div>
			</section>
			<aside class="block attention-col">
				<AttentionList
					{items}
					title={focusArea ? `Needs attention · ${PROPERTIES[focusArea].name}` : 'Needs attention'}
					onpick={(key) => pickAsset(key, true)}
				/>
			</aside>
		</div>

		<section class="map-block" aria-labelledby="map-title" bind:this={mapSection}>
			<div class="block-head">
				<h2 id="map-title" class="ops-eyebrow">Map · {pText}</h2>
				<p class="hint">Drag to move · Ctrl/⌘ + scroll or two fingers to zoom · right-drag to rotate · click the map for keyboard shortcuts</p>
			</div>
			<div class="map-frame">
				<OpsMap
					bind:this={map}
					data={ops}
					{period}
					{selectedAsset}
					{selectedProperty}
					onasset={(key) => pickAsset(key)}
					onproperty={(key) => pickProperty(key)}
					onfeature={(info) => {
						selectedAsset = null;
						feature = info;
					}}
				/>
				{#if asset}
					<AssetDetail
						{asset}
						{dates}
						{period}
						live={liveSnap?.wells[asset.key] ?? null}
						notLinked={liveSnap?.notLinked[asset.key] ?? null}
						syncedAt={liveSnap?.syncedAt ?? null}
						{now}
						onclose={() => pickAsset(null)}
					/>
				{:else if feature}
					<FeatureDetail info={feature} onclose={() => (feature = null)} />
				{/if}
			</div>
		</section>

		<p class="foot">
			{#if amplifiedMode}
				Sources: {ops.source}; BLM (Crawford Ranch); U.S. Census TIGER (routes, state line); USGS The National Map (background map). Winkler Ranch’s boundary is LeaCo map data and isn’t shown here.
			{:else}
				Sources: {ops.source}; Amplified pumper-note snapshot; NM OCD well records (approximate locations); LeaCo KMZ (Winkler Ranch); BLM (Crawford Ranch); U.S. Census TIGER (routes, state line); USGS The National Map (background map).
			{/if}
			Operating-area outlines are drawn around LeaCo’s wells, not legal lease lines.
		</p>
	</main>
</div>

<style>
	.dash {
		--gutter: clamp(16px, 2.5vw, 28px);
	}

	.top {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px 24px;
		padding: 14px var(--gutter) 12px;
		background: rgb(236 233 225 / 94%);
		backdrop-filter: blur(6px);
		border-bottom: 1px solid var(--ops-line);
	}

	.brand {
		display: grid;
		gap: 2px;
	}

	.brand h1 {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.1;
	}

	.asof {
		font-size: 12.5px;
		color: var(--ops-muted);
	}

	.asof b {
		color: var(--ops-ink);
		font-weight: 600;
	}

	.picker {
		width: min(420px, 100%);
	}

	.body {
		max-width: 1480px;
		margin: 0 auto;
		padding: 18px var(--gutter) 32px;
		display: grid;
		gap: 24px;
	}

	.block {
		display: grid;
		gap: 10px;
		align-content: start;
		min-width: 0;
	}

	.block-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 4px 16px;
	}

	.hint {
		font-size: 12px;
		color: var(--ops-muted);
	}

	.check {
		font-size: 12.5px;
		color: var(--ops-muted);
		background: var(--ops-panel);
		border: 1px dashed var(--ops-line);
		border-radius: 8px;
		padding: 6px 10px;
	}

	.check.bad {
		color: var(--ops-danger);
		background: var(--ops-danger-soft);
		border-color: var(--ops-danger);
	}

	.source {
		display: grid;
		gap: 6px;
		font-size: 13px;
		background: var(--ops-panel);
		border: 1px dashed var(--ops-line);
		border-radius: var(--ops-radius);
		padding: 12px 14px;
	}

	.source summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--ops-accent);
		width: fit-content;
	}

	.source ul {
		display: grid;
		gap: 2px;
		margin-top: 4px;
		padding-left: 4px;
		font-size: 12.5px;
	}

	.linkish {
		color: var(--ops-accent);
		text-decoration: underline;
		font-weight: 600;
	}

	.missing-card {
		display: grid;
		align-content: center;
		gap: 6px;
		background: var(--ops-sunken);
		border: 1px dashed var(--ops-line);
		border-radius: var(--ops-radius);
		padding: 14px;
		font-size: 13px;
		color: var(--ops-muted);
	}

	.missing-card b {
		color: var(--ops-ink);
	}

	.trends {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
		gap: 12px;
	}

	.table-view summary {
		cursor: pointer;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ops-accent);
		width: fit-content;
	}

	.table-scroll {
		overflow-x: auto;
		margin-top: 8px;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th,
	td {
		text-align: right;
		padding: 6px 12px;
		border-bottom: 1px solid var(--ops-sunken);
		white-space: nowrap;
	}

	thead th {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	th[scope='row'],
	thead th:first-child {
		text-align: left;
	}

	tr.sel {
		background: var(--ops-accent-soft);
		font-weight: 600;
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: 24px;
		align-items: start;
	}

	.props {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
		gap: 12px;
		align-items: start;
	}

	.attention-col {
		background: var(--ops-sunken);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		padding: 12px;
		position: sticky;
		top: 110px;
		max-height: calc(100vh - 130px);
		overflow-y: auto;
	}

	.map-block {
		display: grid;
		gap: 10px;
		scroll-margin-top: 100px;
	}

	.map-frame {
		position: relative;
		height: clamp(480px, 78vh, 900px);
		border: 1px solid var(--ops-line);
		border-radius: 14px;
		overflow: hidden;
		background: var(--ops-bg);
		box-shadow: var(--ops-shadow);
	}

	.foot {
		font-size: 11px;
		color: var(--ops-muted);
	}

	@media (max-width: 1100px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}

		.attention-col {
			position: static;
			max-height: none;
		}
	}

	@media (max-width: 639px) {
		.top {
			position: static;
		}

		.map-frame {
			height: 72vh;
			border-radius: 10px;
		}

		.map-block {
			scroll-margin-top: 8px;
		}
	}
</style>
