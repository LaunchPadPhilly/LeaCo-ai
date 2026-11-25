<script lang="ts">
	import { inPeriod, shortDay, type Period } from '$lib/leaco/ops/period';

	/**
	 * One daily series as columns (volumes) or a line (counts), selected period shaded.
	 * Single series: the title names it, so no legend. Missing days are drawn as an outlined
	 * "no report" stub, never as zero (brief §4 rule 1). Hover or arrow keys show a day;
	 * click or Enter selects that day as the period.
	 */
	let {
		title,
		subtitle,
		values,
		dates,
		period,
		color,
		kind = 'bar',
		format,
		yMax,
		onpick
	}: {
		title: string;
		subtitle: string;
		values: (number | null)[];
		dates: string[];
		period: Period;
		color: string;
		kind?: 'bar' | 'line';
		format: (v: number) => string;
		/** Fixed top of the axis, e.g. the total count of wells. */
		yMax?: number;
		onpick: (i: number) => void;
	} = $props();

	let width = $state(320);
	const H = 150;
	const PAD = { l: 44, r: 12, t: 18, b: 22 };
	let hover = $state<number | null>(null);

	const geo = $derived.by(() => {
		const known = values.filter((v): v is number => v !== null);
		const rawMax = yMax ?? Math.max(...known, 1);
		const max = niceMax(rawMax);
		const n = values.length;
		const plotW = Math.max(width - PAD.l - PAD.r, 40);
		const step = plotW / n;
		const bw = Math.min(24, Math.max(step - 2, 2));
		const X = (i: number) => PAD.l + step * i + step / 2;
		const Y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
		const ticks = [0, max / 2, max];
		const segments: string[] = [];
		let cur: string[] = [];
		values.forEach((v, i) => {
			if (v === null) {
				if (cur.length) segments.push(cur.join(' '));
				cur = [];
			} else cur.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
		});
		if (cur.length) segments.push(cur.join(' '));
		const labelEvery = Math.ceil(n / Math.max(Math.floor(plotW / 48), 1));
		return { max, step, bw, X, Y, ticks, segments, labelEvery, base: Y(0) };
	});

	function niceMax(v: number): number {
		if (v <= 0) return 1;
		const p = 10 ** Math.floor(Math.log10(v));
		for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
		return 10 * p;
	}

	/** Column with a 4px rounded data-end, square at the baseline. */
	function column(x: number, y: number, w: number, base: number): string {
		const h = base - y;
		const r = Math.min(4, w / 2, h);
		const l = x - w / 2;
		return `M${l},${base}V${y + r}Q${l},${y} ${l + r},${y}H${l + w - r}Q${l + w},${y} ${l + w},${y + r}V${base}Z`;
	}

	// Axis ticks are clean whole numbers (compact from 10K); values keep their own precision.
	const tick = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}K` : Math.round(v).toLocaleString('en-US'));
	const end = $derived(values[period.e]);

	function onKey(e: KeyboardEvent) {
		const i = hover ?? period.e;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			hover = Math.min(values.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)));
		} else if ((e.key === 'Enter' || e.key === ' ') && hover !== null) {
			e.preventDefault();
			onpick(hover);
		}
	}
</script>

<figure class="trend">
	<figcaption>
		<span class="t">{title}</span>
		<span class="s">{subtitle}</span>
	</figcaption>
	<div class="plot" bind:clientWidth={width}>
		<svg
			{width}
			height={H}
			role="slider"
			tabindex="0"
			aria-label="{title} by day. Left and right arrows read each day; Enter shows that day."
			aria-valuemin={0}
			aria-valuemax={values.length - 1}
			aria-valuenow={hover ?? period.e}
			aria-valuetext="{shortDay(dates[hover ?? period.e])}: {values[hover ?? period.e] === null ? 'no report' : format(values[hover ?? period.e] as number)}"
			onkeydown={onKey}
			onblur={() => (hover = null)}
			onpointerleave={() => (hover = null)}
		>
			<!-- selected period -->
			<rect
				x={geo.X(period.s) - geo.step / 2}
				y={PAD.t - 6}
				width={geo.step * (period.e - period.s + 1)}
				height={geo.base - PAD.t + 6}
				fill="var(--ops-accent)"
				opacity="0.07"
				rx="4"
			/>
			<!-- recessive grid + y ticks -->
			{#each geo.ticks as v (v)}
				<line x1={PAD.l} x2={width - PAD.r} y1={geo.Y(v)} y2={geo.Y(v)} stroke="#E6E2D9" stroke-width="1" />
				<text x={PAD.l - 6} y={geo.Y(v) + 3.5} text-anchor="end" class="axis">{tick(v)}</text>
			{/each}

			{#if kind === 'bar'}
				{#each values as v, i (i)}
					{#if v !== null && v > 0}
						<path d={column(geo.X(i), geo.Y(v), geo.bw, geo.base)} fill={color} opacity={inPeriod(i, period) || hover === i ? 1 : 0.45} />
					{:else if v === null}
						<rect x={geo.X(i) - geo.bw / 2} y={geo.base - 6} width={geo.bw} height="6" fill="none" stroke="#6B7280" stroke-dasharray="2 2" />
					{/if}
				{/each}
			{:else}
				{#each geo.segments as points, i (i)}
					<polyline {points} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
				{/each}
				{#each values as v, i (i)}
					{#if v !== null}
						<circle cx={geo.X(i)} cy={geo.Y(v)} r={hover === i || i === period.e ? 5 : 4} fill={color} stroke="#fff" stroke-width="2" opacity={inPeriod(i, period) || hover === i ? 1 : 0.5} />
					{/if}
				{/each}
			{/if}

			<!-- direct label: the period's last day only -->
			{#if end !== null && end !== undefined}
				<text x={geo.X(period.e)} y={geo.Y(end) - 8} text-anchor="middle" class="val">{format(end)}</text>
			{/if}

			<!-- x labels -->
			{#each dates as d, i (d)}
				{#if i % geo.labelEvery === 0 || i === dates.length - 1}
					<text x={geo.X(i)} y={H - 6} text-anchor="middle" class="axis">{shortDay(d)}</text>
				{/if}
			{/each}

			<!-- hit targets, full height, wider than the marks -->
			{#each values as _, i (i)}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<rect
					x={geo.X(i) - geo.step / 2}
					y={PAD.t - 6}
					width={geo.step}
					height={geo.base - PAD.t + 6}
					fill="transparent"
					class="hit"
					onpointerenter={() => (hover = i)}
					onclick={() => onpick(i)}
				/>
			{/each}
			{#if hover !== null}
				<line x1={geo.X(hover)} x2={geo.X(hover)} y1={PAD.t - 6} y2={geo.base} stroke="var(--ops-ink)" stroke-opacity="0.25" stroke-width="1" pointer-events="none" />
			{/if}
		</svg>
		{#if hover !== null}
			{@const v = values[hover]}
			<div class="tip" style:left="{Math.min(Math.max(geo.X(hover), 70), width - 70)}px" role="status">
				<b>{shortDay(dates[hover])}</b>
				<span>{v === null ? 'No report' : format(v)}</span>
				<small>Click to show this day</small>
			</div>
		{/if}
	</div>
</figure>

<style>
	.trend {
		margin: 0;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		padding: 10px 12px 6px;
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	figcaption {
		display: grid;
	}

	.t {
		font-size: 13px;
		font-weight: 700;
	}

	.s {
		font-size: 11.5px;
		color: var(--ops-muted);
	}

	.plot {
		position: relative;
	}

	svg {
		display: block;
		overflow: visible;
	}

	svg:focus-visible {
		outline: 2.5px solid var(--ops-accent);
		outline-offset: 2px;
		border-radius: 6px;
	}

	.axis {
		font-size: 10.5px;
		fill: var(--ops-muted);
	}

	.val {
		font-size: 11.5px;
		font-weight: 700;
		fill: var(--ops-ink);
		paint-order: stroke;
		stroke: var(--ops-panel);
		stroke-width: 3px;
	}

	.hit {
		cursor: pointer;
	}

	.tip {
		position: absolute;
		top: -6px;
		transform: translate(-50%, -100%);
		pointer-events: none;
		background: var(--ops-ink);
		color: #fff;
		border-radius: 7px;
		padding: 5px 9px;
		font-size: 12px;
		display: grid;
		white-space: nowrap;
		z-index: 2;
	}

	.tip small {
		color: #c9ced3;
		font-size: 10.5px;
	}
</style>
