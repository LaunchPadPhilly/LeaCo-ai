<script lang="ts">
	import { GROUPED_EXPLAINER, pressureText, volumeText } from '$lib/leaco/ops/assetText';
	import { fmt } from '$lib/leaco/ops/format';
	import { dayCountOf, inPeriod, periodLabel, shortDay, type Period } from '$lib/leaco/ops/period';
	import { PROPERTIES } from '$lib/leaco/ops/properties';
	import { INJECTOR_STATUS, WELL_STATUS, injectorPeriod, wellStatus } from '$lib/leaco/ops/status';
	import type { OpsAsset } from '$lib/leaco/ops/types';
	import { LOCATION_CAVEAT, appleDirectionsUrl, coordinates, googleDirectionsUrl, shareText } from '$lib/leaco/ops/directions';
	import type { LiveWell } from '$lib/leaco/ops/live';
	import AssetGlyph from './AssetGlyph.svelte';
	import LiveWellBox from './LiveWellBox.svelte';
	import InjectorChart from './InjectorChart.svelte';

	let {
		asset,
		dates,
		period,
		live = null,
		notLinked = null,
		syncedAt = null,
		now = Date.now(),
		onclose
	}: {
		asset: OpsAsset;
		dates: string[];
		period: Period;
		live?: LiveWell | null;
		notLinked?: string | null;
		syncedAt?: string | null;
		now?: number;
		onclose: () => void;
	} = $props();

	let panel: HTMLElement | undefined = $state();

	// ---------- send someone here
	let copied = $state<'ok' | 'failed' | null>(null);
	let canShare = $state(false);
	$effect(() => {
		canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
	});
	$effect(() => {
		void asset.key;
		copied = null;
	});
	async function copyLocation() {
		try {
			await navigator.clipboard.writeText(shareText(asset));
			copied = 'ok';
		} catch {
			copied = 'failed';
		}
	}
	async function shareLocation() {
		try {
			await navigator.share({ title: asset.name, text: shareText(asset) });
		} catch {
			/* cancelled by the user, or not allowed: nothing to do */
		}
	}
	$effect(() => {
		void asset.key;
		panel?.scrollTo({ top: 0 });
		panel?.focus({ preventScroll: true });
	});

	const pText = $derived(periodLabel(dates, period));
	const endDay = $derived(shortDay(dates[period.e]));
	const inj = $derived(asset.kind === 'injector' ? injectorPeriod(asset, period) : null);
	const style = $derived(asset.kind === 'well' ? WELL_STATUS[wellStatus(asset, period)] : INJECTOR_STATUS[inj!.status]);
	const snapshot = $derived(asset.snapshotDate ? shortDay(asset.snapshotDate) : null);

	const runtimeMentioned = $derived.by(() => {
		for (let i = period.e; i >= 0; i--) if (asset.days[i]?.runtime !== null) return { i, rt: asset.days[i].runtime! };
		return null;
	});
	const runtimeDays = $derived(asset.days.map((d, i) => ({ d, i })).filter(({ d }) => d.runtime !== null).reverse());

	const notesInPeriod = $derived(asset.days.map((d, i) => ({ d, i })).filter(({ d, i }) => d.notes.length && inPeriod(i, period)).reverse());
	const notesOutside = $derived(asset.days.filter((d, i) => d.notes.length && !inPeriod(i, period)).length);
	const mentioned = $derived(asset.days.some((d) => d.notes.length || d.runtime !== null || d.volumeSource === 'reading' || d.volumeSource === 'no-reading'));
	const anyGrouped = $derived(asset.days.some((d) => d.volumeSource === 'grouped'));

	const rows = $derived.by(() => {
		const r: [string, string | null][] = [];
		if (asset.kind === 'injector') {
			r.push([`Injected on ${endDay}`, volumeText(asset.days[period.e])]);
			r.push(['Average pressure that day', pressureText(asset.days[period.e])]);
		} else {
			r.push([`Latest runtime mentioned (to ${endDay})`, runtimeMentioned ? `${runtimeMentioned.rt}% on ${shortDay(dates[runtimeMentioned.i])}` : null]);
			r.push([`Runtime, 7-day average${snapshot ? ` (Amplified, ${snapshot})` : ''}`, asset.runtime7]);
			r.push([`Control mode${snapshot ? ` (Amplified, ${snapshot})` : ''}`, asset.controlMode]);
		}
		r.push(['Area', PROPERTIES[asset.area].name]);
		r.push(['Lease type', asset.landType]);
		r.push(['Operator of record', asset.operator]);
		r.push(['State well name', asset.stateName]);
		return r.filter(([, v]) => v !== null && v !== '');
	});
</script>

<aside class="detail" aria-labelledby="detail-title" bind:this={panel} tabindex="-1">
	<header>
		<div class="title">
			<svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><AssetGlyph kind={asset.kind} {style} /></svg>
			<div>
				<h2 id="detail-title">{asset.name}</h2>
				<p class="sub">
					{asset.kind === 'well' ? 'Producing well' : 'Injector'} ·
					<b style:color={style.color === '#8DB8E8' ? '#3E7FBF' : style.color}>{style.label}</b>
					· {asset.kind === 'injector' && period.s !== period.e ? pText : `as of ${endDay}`}
				</p>
			</div>
		</div>
		<button type="button" class="close" onclick={onclose} aria-label="Close details (Esc)">×</button>
	</header>

	<dl class="ids">
		<div><dt>API</dt><dd>{asset.api ?? 'No data'}</dd></div>
		<div><dt>Amplified ID</dt><dd>{asset.amplifiedId ?? 'Not in Amplified list'}</dd></div>
		<div><dt>Customer ID</dt><dd>{asset.customerId ?? 'No data'}</dd></div>
	</dl>
	{#if asset.idNote}
		<p class="issue"><b>Known ID issue.</b> {asset.idNote}</p>
	{/if}

	<LiveWellBox well={live} {notLinked} {syncedAt} {now} />

	<section class="go" aria-labelledby="go-title">
		<h3 id="go-title">Send someone here</h3>
		<p class="coords"><span>{coordinates(asset)}</span> <small>{LOCATION_CAVEAT}</small></p>
		<div class="go-actions">
			<a class="go-btn primary" href={googleDirectionsUrl(asset)} target="_blank" rel="noopener noreferrer">Google Maps</a>
			<a class="go-btn" href={appleDirectionsUrl(asset)} target="_blank" rel="noopener noreferrer">Apple Maps</a>
			<button type="button" class="go-btn" onclick={copyLocation}>Copy location</button>
			{#if canShare}<button type="button" class="go-btn" onclick={shareLocation}>Share…</button>{/if}
		</div>
		{#if copied === 'ok'}
			<p class="go-msg" role="status">Copied: name, API number, coordinates and both map links.</p>
		{:else if copied === 'failed'}
			<p class="go-msg bad" role="status">Couldn’t copy here. Select the coordinates above instead.</p>
		{/if}
		<p class="fine">Directions get them to the area on public roads. Confirm the lease-road approach and any gates with LeaCo or the pumpers.</p>
	</section>

	{#if inj && period.s !== period.e}
		<p class="period-sum">{pText}: <b>{inj.volume === null ? 'No readings' : `${fmt(inj.volume)} bbl`}</b>, took water {inj.daysTaking} of {dayCountOf(period)} day{dayCountOf(period) > 1 ? 's' : ''}</p>
	{/if}

	<table class="rows">
		<tbody>
			{#each rows as [k, v] (k)}<tr><th scope="row">{k}</th><td>{v}</td></tr>{/each}
		</tbody>
	</table>

	{#if asset.pumperNote}
		<section class="note">
			<h3>Latest pumper note{snapshot ? ` (Amplified report, ${snapshot})` : ''}</h3>
			<p>{asset.pumperNote}</p>
		</section>
	{/if}

	{#if asset.kind === 'injector'}
		<section>
			<h3>Daily injection <span class="ops-muted">(shaded = {pText})</span></h3>
			<InjectorChart days={asset.days} {dates} {period} />
			{#if anyGrouped}<p class="fine">{GROUPED_EXPLAINER}</p>{/if}
		</section>
	{:else if runtimeDays.length}
		<section>
			<h3>Runtime mentioned in daily reports</h3>
			<table class="rows">
				<tbody>
					{#each runtimeDays as { d, i } (i)}
						<tr class:dim={!inPeriod(i, period)}><th scope="row">{shortDay(dates[i])}</th><td>{d.runtime}%</td></tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if notesInPeriod.length}
		<section>
			<h3>What the daily reports said, {pText}</h3>
			<ul class="notes">
				{#each notesInPeriod as { d, i } (i)}
					<li><b>{shortDay(dates[i])}:</b> {d.notes.join(' ')}</li>
				{/each}
			</ul>
		</section>
	{/if}
	{#if notesOutside}
		<p class="fine">{notesOutside} more day{notesOutside > 1 ? 's' : ''} of notes outside {pText}. Widen the period to see them.</p>
	{/if}
	{#if !mentioned}
		<p class="fine">Not mentioned in the {dates.length} daily reports.{snapshot ? ` Status details are from the Amplified snapshot of ${snapshot}.` : ''}</p>
	{/if}

	<p class="src">Sources: LeaCo Daily Reports {shortDay(dates[0])}–{shortDay(dates[dates.length - 1])}{snapshot ? `; Amplified snapshot ${snapshot}` : ''}; NM OCD (API number, operator, location; approximate).</p>
</aside>

<style>
	.detail {
		position: absolute;
		/* Below the search / Layers row (52px) so the Layers button never covers the title. */
		top: 62px;
		right: 12px;
		bottom: 12px;
		width: min(380px, calc(100% - 24px));
		overflow-y: auto;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 12px;
		box-shadow: var(--ops-shadow);
		padding: 14px 16px 18px;
		display: grid;
		align-content: start;
		gap: 12px;
		z-index: 4;
		outline: none;
	}

	header {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.title {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}

	.title svg {
		flex: none;
		margin-top: 2px;
	}

	h2 {
		font-size: 17px;
		font-weight: 700;
		line-height: 1.25;
	}

	.sub {
		font-size: 12.5px;
		color: var(--ops-muted);
	}

	.close {
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		font-size: 22px;
		line-height: 1;
		color: var(--ops-muted);
	}

	.close:hover {
		background: var(--ops-sunken);
		color: var(--ops-ink);
	}

	.ids {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		background: var(--ops-sunken);
		border-radius: 8px;
		padding: 8px 10px;
	}

	.ids dt {
		font-size: 10.5px;
		color: var(--ops-muted);
	}

	.ids dd {
		font-size: 12.5px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.issue {
		font-size: 12.5px;
		background: #fbf4e4;
		color: #6b4f15;
		border-left: 3px solid #d39b2a;
		border-radius: 6px;
		padding: 6px 9px;
	}

	.go {
		display: grid;
		gap: 8px;
		border: 1px solid var(--ops-line);
		border-radius: 10px;
		padding: 10px 12px;
	}

	.coords span {
		font-size: 14px;
		font-weight: 700;
		user-select: all;
	}

	.coords small {
		display: block;
		font-size: 11.5px;
		color: #8a6417;
	}

	.go-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.go-btn {
		display: grid;
		place-items: center;
		min-height: 44px;
		border: 1px solid var(--ops-line);
		border-radius: 9px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ops-ink);
		text-decoration: none;
		background: var(--ops-panel);
	}

	.go-btn:hover {
		border-color: var(--ops-accent);
		color: var(--ops-accent);
	}

	.go-btn.primary {
		background: var(--ops-accent);
		border-color: var(--ops-accent);
		color: #fff;
	}

	.go-btn.primary:hover {
		background: #0b5a73;
		color: #fff;
	}

	.go-msg {
		font-size: 12px;
		color: var(--ops-good);
	}

	.go-msg.bad {
		color: var(--ops-danger);
	}

	.period-sum {
		font-size: 13px;
	}

	.rows {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}

	.rows th {
		text-align: left;
		font-weight: 400;
		color: var(--ops-muted);
		padding: 4px 8px 4px 0;
		vertical-align: top;
		width: 52%;
	}

	.rows td {
		padding: 4px 0;
		font-weight: 600;
	}

	.rows tr + tr :is(th, td) {
		border-top: 1px solid var(--ops-sunken);
	}

	.rows tr.dim :is(th, td) {
		opacity: 0.5;
	}

	section {
		display: grid;
		gap: 6px;
	}

	h3 {
		font-size: 12.5px;
		font-weight: 700;
	}

	.note {
		background: var(--ops-accent-soft);
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
	}

	.notes {
		display: grid;
		gap: 6px;
		font-size: 12.5px;
	}

	.fine,
	.src {
		font-size: 11.5px;
		color: var(--ops-muted);
	}

	@media (max-width: 639px) {
		.detail {
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: 100%;
			max-height: 70%;
			border-radius: 14px 14px 0 0;
		}
	}
</style>
