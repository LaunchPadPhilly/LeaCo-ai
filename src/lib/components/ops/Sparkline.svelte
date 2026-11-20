<script lang="ts">
	import type { Period } from '$lib/leaco/ops/period';

	/**
	 * Small daily trend with the selected period shaded. Missing days break the line and
	 * are never drawn as zero (brief §4 rule 1).
	 */
	let {
		values,
		period,
		color,
		label,
		width = 132,
		height = 26
	}: { values: (number | null)[]; period: Period; color: string; label: string; width?: number; height?: number } = $props();

	const geo = $derived.by(() => {
		const known = values.filter((v): v is number => v !== null);
		const max = Math.max(...known, 1);
		const min = Math.min(...known, 0);
		const n = Math.max(values.length - 1, 1);
		const X = (i: number) => 2 + (i * (width - 4)) / n;
		const Y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
		const segments: string[] = [];
		let current: string[] = [];
		values.forEach((v, i) => {
			if (v === null) {
				if (current.length) segments.push(current.join(' '));
				current = [];
			} else current.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
		});
		if (current.length) segments.push(current.join(' '));
		const pad = period.s === period.e ? 3 : 0;
		const end = values[period.e];
		return {
			x0: X(period.s) - pad,
			x1: X(period.e) + pad,
			segments,
			dot: end === null || end === undefined ? null : { x: X(period.e), y: Y(end) }
		};
	});
</script>

<svg {width} {height} role="img" aria-label={label}>
	<rect x={geo.x0} y="0" width={Math.max(geo.x1 - geo.x0, 2)} {height} rx="2" fill={color} opacity="0.12" />
	{#each geo.segments as points, i (i)}
		<polyline fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" {points} />
	{/each}
	{#if geo.dot}<circle cx={geo.dot.x} cy={geo.dot.y} r="2.6" fill={color} />{/if}
</svg>
