<script lang="ts">
	import { easeCubicOut, interpolateNumber, select, timer, zoom, zoomIdentity, zoomTransform, type Timer, type ZoomBehavior } from 'd3';
	import { onMount } from 'svelte';
	import { fmt } from '$lib/leaco/ops/format';
	import { dayCountOf, shortDay, type Period } from '$lib/leaco/ops/period';
	import { AREA_KEYS, DELIVERY_POINT, PROPERTIES, PROPERTY_KEYS } from '$lib/leaco/ops/properties';
	import { assetStyle, injectorPeriod } from '$lib/leaco/ops/status';
	import { volumeText, pressureText } from '$lib/leaco/ops/assetText';
	import type { FeatureInfo } from '$lib/leaco/ops/feature';
	import { parseLayerState, viewState, type LayerState } from '$lib/leaco/ops/layers';
	import { BASEMAPS, BASEMAP_STORAGE_SUFFIX, DEFAULT_BASEMAP, parseBasemap, tileBounds, tilesFor, zoomFor, type BasemapId } from '$lib/leaco/ops/basemap';
	import type { AreaKey, LonLat, OpsAsset, OpsData, PropertyKey, Route } from '$lib/leaco/ops/types';
	import { storageKeyPrefix } from '$lib/appConfig';
	import AssetGlyph from './AssetGlyph.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import { ALL_AREAS, boundsOf, lineD, makeProjection, polygonsD, projector, rotatePoint, scaleBar } from './geo';

	let {
		data,
		period,
		selectedAsset = null,
		selectedProperty = null,
		onasset,
		onproperty,
		onfeature
	}: {
		data: OpsData;
		period: Period;
		selectedAsset?: string | null;
		selectedProperty?: PropertyKey | null;
		onasset: (key: string | null) => void;
		onproperty: (key: PropertyKey | null) => void;
		onfeature: (info: FeatureInfo) => void;
	} = $props();

	// ---------- layers (per-viewer choice, remembered in this browser only)
	const LAYERS_KEY = `${storageKeyPrefix}ops-layers`;
	let layers = $state<LayerState>(viewState('ops'));
	let layersReady = false;
	let layersPanel: LayersPanel | undefined = $state();
	$effect(() => {
		const json = JSON.stringify(layers);
		if (!layersReady) return;
		try {
			localStorage.setItem(LAYERS_KEY, json);
		} catch {
			/* storage unavailable: the choice just isn't remembered */
		}
	});

	// ---------- background map (USGS): Topo unless changed in Settings → Map (stored per browser)
	const BASEMAP_KEY = `${storageKeyPrefix}${BASEMAP_STORAGE_SUFFIX}`;
	let basemap = $state<BasemapId>(DEFAULT_BASEMAP);

	/** Tiles for the visible screen (rotation included), plus the level below as a no-flash fallback. */
	const basemapTiles = $derived.by(() => {
		const bm = BASEMAPS[basemap];
		if (!bm.url || !w || !h || !proj.invert) return { top: [], under: [] };
		const corners = (
			[
				[0, 0],
				[w, 0],
				[0, h],
				[w, h]
			] as const
		).map(([sx, sy]) => {
			const [vx, vy] = rotatePoint((sx - t.x) / t.k, (sy - t.y) / t.k, -rot.a, rot.px, rot.py);
			return proj.invert!([vx, vy]) as LonLat;
		});
		const lons = corners.map((c) => c[0]);
		const lats = corners.map((c) => c[1]);
		const box: [LonLat, LonLat] = [
			[Math.max(-180, Math.min(...lons)), Math.max(-85, Math.min(...lats))],
			[Math.min(180, Math.max(...lons)), Math.min(85, Math.max(...lats))]
		];
		let z = Math.min(bm.maxZoom, Math.max(3, zoomFor(proj.scale() * t.k)));
		let list = tilesFor(box, z);
		while (!list && z > 3) list = tilesFor(box, --z);
		const place = (tiles: { z: number; x: number; y: number }[]) =>
			tiles.map((tl) => {
				const { nw, se } = tileBounds(tl.z, tl.x, tl.y);
				const a = P(nw);
				const b = P(se);
				const seam = 1 / t.k; // ~1 screen pixel of overlap hides hairline seams
				return { key: `${tl.z}/${tl.x}/${tl.y}`, href: bm.url!(tl.z, tl.x, tl.y), x: a[0], y: a[1], w: b[0] - a[0] + seam, h: b[1] - a[1] + seam };
			});
		return { top: place(list ?? []), under: z > 3 ? place(tilesFor(box, z - 1, 60) ?? []) : [] };
	});

	function openFeature(e: Event, info: FeatureInfo) {
		e.stopPropagation();
		tip = null;
		layersPanel?.close();
		onfeature(info);
	}
	function pickAsset(e: Event, key: string) {
		e.stopPropagation();
		layersPanel?.close();
		onasset(key);
	}
	function routeInfo(r: Route): FeatureInfo {
		return {
			title: `${r.from} → ${r.to}`,
			source: 'Route on public roads · U.S. Census TIGER',
			rows: [['Distance', `${r.miles} mi`], ...r.via.map(([road, mi], i): [string, string] => [`${i + 1}. ${road}`, `${mi} mi`])],
			note: {
				head: 'How sure is this?',
				text: 'Shortest drive on public roads, preferring highways, not confirmed with LeaCo. It ends where public roads meet the area; lease roads inside aren’t mapped. Ask the pumpers which way they actually drive.'
			}
		};
	}
	// ---------- static geometry (projected once)
	const proj = makeProjection();
	const P = projector(proj);

	const geom = $derived.by(() => {
		const hulls = AREA_KEYS.map((k) => {
			const ring = data.hulls[k];
			const top = ring.reduce((m, c) => (c[1] > m[1] ? c : m), ring[0]);
			const xs = ring.map((c) => c[0]);
			return { key: k, d: lineD(P, ring, true), label: P([(Math.min(...xs) + Math.max(...xs)) / 2, top[1]]) };
		});
		return {
			hulls,
			texas: polygonsD(P, data.texas),
			stateLine: data.stateLine.map((l) => lineD(P, l)),
			winkler: polygonsD(P, data.winklerBoundary),
			crawford: polygonsD(P, data.crawford),
			// Wells known only to Amplified have no location: they are listed on the page, not drawn here.
			assets: data.assets.flatMap((a) => (a.lon === null || a.lat === null ? [] : [{ a, p: P([a.lon, a.lat]) }])),
			dp: P(DELIVERY_POINT),
			routes: data.routes.map((r) => {
				const first = r.lines[0] ?? [];
				return { r, d: r.lines.map((l) => lineD(P, l)).join(''), tag: first.length ? P(first[Math.floor(first.length * 0.6)]) : null };
			}),
			gaps: data.roadGaps.map((g) => {
				const [a, b] = [g.line[0], g.line[g.line.length - 1]];
				return { g, d: lineD(P, g.line), tag: P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) };
			}),
			stateLabelsNS: [-103.31, -103.24, -103.17, -103.1].map((x, i) => ({ p: P([x, 32.0003]), dense: i >= 2 })),
			stateLabelsEW: [32.08, 32.18, 32.28, 32.4, 32.55, 32.69].map((y, i) => ({ p: P([-103.0645, y]), dense: [1, 3, 4].includes(i) }))
		};
	});

	// ---------- view state
	let host: HTMLDivElement | undefined = $state();
	let svgEl: SVGSVGElement | undefined = $state();
	let searchEl: HTMLInputElement | undefined = $state();
	let w = $state(0);
	let h = $state(0);
	let t = $state({ x: 0, y: 0, k: 1 });
	let rot = $state({ a: 0, px: 0, py: 0 });
	/** Scale at which "all areas" fits; symbol sizing and label density are relative to it. */
	let kFit = $state(1);
	let zoomer: ZoomBehavior<SVGSVGElement, unknown> | null = null;
	let rotTimer: Timer | null = null;

	const kRel = $derived(t.k / kFit);
	const symScale = $derived(Math.min(1.35, Math.max(0.6, 0.4 + Math.log2(kRel + 1) / 6)) / t.k);
	const dense = $derived(kRel >= 5);
	const symT = (p: [number, number]) => `translate(${p[0]},${p[1]}) rotate(${-rot.a}) scale(${symScale})`;

	const bar = $derived(
		w ? scaleBar(proj, [(w / 2 - t.x) / t.k, (h / 2 - t.y) / t.k], [(w / 2 + 100 - t.x) / t.k, (h / 2 - t.y) / t.k]) : { px: 0, label: '' }
	);

	function fitBounds([[x0, y0], [x1, y1]]: [LonLat, LonLat], pad = 60, animate = true) {
		if (!svgEl || !zoomer || !w || !h) return;
		const a = P([x0, y1]);
		const b = P([x1, y0]);
		const r = (rot.a * Math.PI) / 180;
		const bw = b[0] - a[0];
		const bh = b[1] - a[1];
		const rw = Math.abs(bw * Math.cos(r)) + Math.abs(bh * Math.sin(r));
		const rh = Math.abs(bw * Math.sin(r)) + Math.abs(bh * Math.cos(r));
		const k = Math.min((w - 2 * pad) / Math.max(rw, 1e-6), (h - 2 * pad) / Math.max(rh, 1e-6));
		const c = rotatePoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, rot.a, rot.px, rot.py);
		const target = zoomIdentity.translate(w / 2 - k * c[0], h / 2 - k * c[1]).scale(k);
		const sel = select(svgEl);
		if (animate) sel.transition().duration(650).call(zoomer.transform, target);
		else sel.call(zoomer.transform, target);
	}

	function propertyBounds(key: PropertyKey): [LonLat, LonLat] {
		const prop = PROPERTIES[key];
		return prop.bounds ?? boundsOf(data.hulls[key as AreaKey]);
	}

	export function showAll(animate = true) {
		fitBounds(ALL_AREAS, 40, animate);
	}
	export function focusProperty(key: PropertyKey) {
		fitBounds(propertyBounds(key));
	}
	export function focusAsset(key: string) {
		const a = data.assets.find((x) => x.key === key);
		if (a && a.lon !== null && a.lat !== null)
			fitBounds([
				[a.lon - 0.014, a.lat - 0.009],
				[a.lon + 0.014, a.lat + 0.009]
			]);
	}

	function zoomBy(f: number) {
		if (svgEl && zoomer) select(svgEl).transition().duration(250).call(zoomer.scaleBy, f);
	}
	function pan(dx: number, dy: number) {
		if (svgEl && zoomer) select(svgEl).transition().duration(300).call(zoomer.translateBy, (dx * w * 0.25) / t.k, (dy * h * 0.25) / t.k);
	}

	/** Rotate the map about the current screen centre (prototype behaviour). */
	function setRotation(deg: number, animate = true) {
		deg = ((deg % 360) + 360) % 360;
		const from = rot.a;
		let to = deg;
		if (to - from > 180) to -= 360;
		if (from - to > 180) to += 360;
		const step = (a: number) => {
			if (!svgEl || !zoomer) return;
			const cur = zoomTransform(svgEl);
			const c = cur.invert([w / 2, h / 2]);
			const x0 = rotatePoint(c[0], c[1], -rot.a, rot.px, rot.py);
			rot = { a, px: x0[0], py: x0[1] };
			select(svgEl).call(zoomer.transform, zoomIdentity.translate(w / 2 - cur.k * x0[0], h / 2 - cur.k * x0[1]).scale(cur.k));
		};
		rotTimer?.stop();
		rotTimer = null;
		if (!animate) return step(to);
		const i = interpolateNumber(from, to);
		rotTimer = timer((elapsed) => {
			const f = Math.min(1, elapsed / 250);
			step(i(easeCubicOut(f)));
			if (f >= 1) {
				rotTimer?.stop();
				rotTimer = null;
			}
		});
	}

	onMount(() => {
		try {
			const saved = parseLayerState(localStorage.getItem(LAYERS_KEY));
			if (saved) layers = saved;
			basemap = parseBasemap(localStorage.getItem(BASEMAP_KEY)) ?? DEFAULT_BASEMAP;
		} catch {
			/* storage unavailable: start from the Operations set */
		}
		layersReady = true;
		if (!svgEl) return;
		const svg = svgEl;
		// The map sits in a scrolling page, so it only takes gestures that are clearly meant
		// for it: Ctrl/⌘ + wheel (also trackpad pinch), two-finger touch, and left-button
		// drag. A plain wheel or one-finger swipe scrolls the page and shows a hint.
		// Right-button drags are left alone: they rotate instead.
		zoomer = zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.05, 5000])
			.filter((e: Event) => {
				if (e.type === 'wheel') {
					const we = e as WheelEvent;
					if (we.ctrlKey || we.metaKey) return true;
					flashHint('wheel');
					return false;
				}
				if (e.type.startsWith('touch')) {
					const te = e as TouchEvent;
					if (te.touches.length >= 2) return true;
					if (e.type === 'touchstart') flashHint('touch');
					return false;
				}
				const me = e as MouseEvent;
				return !me.ctrlKey && !me.button;
			})
			.on('zoom', (ev) => {
				t = { x: ev.transform.x, y: ev.transform.y, k: ev.transform.k };
			});
		select(svg).call(zoomer).on('dblclick.zoom', null);

		// Initial fit once the container has a size.
		const ro = new ResizeObserver(() => {
			const first = kFit === 1 && t.k === 1;
			w = host?.clientWidth ?? 0;
			h = host?.clientHeight ?? 0;
			if (first && w && h) {
				showAll(false);
				kFit = zoomTransform(svg).k;
			}
		});
		if (host) ro.observe(host);

		// Right-drag rotates about the screen centre.
		let drag: { a0: number; r0: number; id: number } | null = null;
		const ang = (e: PointerEvent) => {
			const r = svg.getBoundingClientRect();
			return (Math.atan2(e.clientY - r.top - h / 2, e.clientX - r.left - w / 2) * 180) / Math.PI;
		};
		const onContext = (e: Event) => e.preventDefault();
		const onDown = (e: PointerEvent) => {
			if (e.button !== 2) return;
			e.preventDefault();
			rotTimer?.stop();
			drag = { a0: ang(e), r0: rot.a, id: e.pointerId };
			svg.setPointerCapture(e.pointerId);
		};
		const onMove = (e: PointerEvent) => {
			if (drag && e.pointerId === drag.id) setRotation(drag.r0 + ang(e) - drag.a0, false);
		};
		const onUp = (e: PointerEvent) => {
			if (!drag || e.pointerId !== drag.id) return;
			drag = null;
			try {
				svg.releasePointerCapture(e.pointerId);
			} catch {
				/* already released */
			}
		};
		svg.addEventListener('contextmenu', onContext);
		svg.addEventListener('pointerdown', onDown);
		svg.addEventListener('pointermove', onMove);
		svg.addEventListener('pointerup', onUp);
		svg.addEventListener('pointercancel', onUp);
		return () => {
			ro.disconnect();
			rotTimer?.stop();
			select(svg).on('.zoom', null);
			svg.removeEventListener('contextmenu', onContext);
			svg.removeEventListener('pointerdown', onDown);
			svg.removeEventListener('pointermove', onMove);
			svg.removeEventListener('pointerup', onUp);
			svg.removeEventListener('pointercancel', onUp);
		};
	});

	// ---------- hover
	let tip = $state<{ x: number; y: number; title: string; sub: string } | null>(null);
	function showTip(e: PointerEvent, title: string, sub: string) {
		if (e.pointerType === 'touch' || !host) return;
		const r = host.getBoundingClientRect();
		tip = { x: e.clientX - r.left + 14, y: e.clientY - r.top + 14, title, sub };
	}

	const endDay = $derived(shortDay(data.dates[period.e]));
	function assetTip(a: OpsAsset): string {
		if (a.kind === 'well') return `${assetStyle(a, period).label} · ${endDay}`;
		if (period.s === period.e) return `${volumeText(a.days[period.e])} · ${pressureText(a.days[period.e])}`;
		const ip = injectorPeriod(a, period);
		return `${ip.volume === null ? 'No readings' : `${fmt(ip.volume)} bbl`} in period · took water ${ip.daysTaking} of ${dayCountOf(period)} days`;
	}

	// ---------- gesture hints
	let hint = $state<'wheel' | 'touch' | null>(null);
	let hintTimer: ReturnType<typeof setTimeout> | undefined;
	function flashHint(kind: 'wheel' | 'touch') {
		hint = kind;
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => (hint = null), 1400);
	}

	// ---------- keyboard: map shortcuts work while the map has focus, so the arrow keys
	// still scroll the page everywhere else. "/" (search) and Esc work page-wide.
	function onWindowKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (/INPUT|SELECT|TEXTAREA/.test(target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === '/') {
			e.preventDefault();
			searchEl?.scrollIntoView({ block: 'nearest' });
			searchEl?.focus();
		} else if (e.key === 'Escape') onasset(null);
	}
	function onKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (/INPUT|SELECT|TEXTAREA/.test(target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
		const panKey: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0] };
		if (panKey[e.key]) {
			e.preventDefault();
			pan(...panKey[e.key]);
		} else if (e.key === '+' || e.key === '=') zoomBy(1.6);
		else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.6);
		else if (e.key === '0') resetAll();
		else if (e.key === 'q' || e.key === 'Q') setRotation(rot.a - 15);
		else if (e.key === 'e' || e.key === 'E') setRotation(rot.a + 15);
		else if (e.key === 'n' || e.key === 'N') setRotation(0);
	}

	function resetAll() {
		onproperty(null);
		showAll();
	}

	// ---------- search and go-to
	let query = $state('');
	let searchMiss = $state(false);
	function runSearch() {
		const q = query
			.trim()
			.toLowerCase()
			.replace(/\bmlmu\b/, 'myers langlie mattix unit')
			.replace(/\beeu\b/, 'east eumont unit');
		if (!q) return;
		const byKey = data.assets.find((a) => a.key.toLowerCase() === query.trim().toLowerCase().replace(/\s+/g, '-'));
		const a = byKey ?? data.assets.find((x) => x.name.toLowerCase() === q) ?? data.assets.find((x) => x.name.toLowerCase().includes(q));
		searchMiss = !a;
		if (a) {
			focusAsset(a.key);
			onasset(a.key);
		}
	}
	function goTo(value: string) {
		if (value === 'all') resetAll();
		else onproperty(value as PropertyKey);
	}
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="map" bind:this={host}>
	<!-- role="application" + tabindex is the standard pattern for a keyboard-operable map: it takes focus and handles its own keys. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
	<svg
		bind:this={svgEl}
		class="canvas"
		role="application"
		tabindex="0"
		onkeydown={onKey}
		aria-label="Map of LeaCo wells, injectors and land. While the map has focus: arrow keys pan, plus and minus zoom, 0 shows all areas, Q and E rotate, N resets north. Ctrl and scroll, or two fingers, zoom."
		onclick={() => onasset(null)}
	>
		<g transform="translate({t.x},{t.y}) scale({t.k})">
			<g transform="rotate({rot.a},{rot.px},{rot.py})">
				<!-- Background map (USGS The National Map), washed back so LeaCo layers stay on top -->
				{#if basemapTiles.top.length}
					<g opacity={BASEMAPS[basemap].opacity} pointer-events="none" aria-hidden="true">
						{#each basemapTiles.under as tl (tl.key)}<image href={tl.href} x={tl.x} y={tl.y} width={tl.w} height={tl.h} preserveAspectRatio="none" />{/each}
						{#each basemapTiles.top as tl (tl.key)}<image href={tl.href} x={tl.x} y={tl.y} width={tl.w} height={tl.h} preserveAspectRatio="none" />{/each}
					</g>
				{/if}

				<!-- Reference: Texas tint (U.S. Census TIGER). Only on the plain background: the data covers a
				     clipped box, which shows as an odd rectangle over a real background map. -->
				{#if layers.state && basemap === 'none'}<path d={geom.texas} fill="rgb(150 120 60 / 7%)" fill-rule="evenodd" />{/if}

				<!-- State line (U.S. Census TIGER) -->
				{#if layers.state}
					{#each geom.stateLine as d, i (i)}
						<path {d} fill="none" stroke="#fff" stroke-width="6" stroke-opacity="0.7" vector-effect="non-scaling-stroke" />
						<path {d} fill="none" stroke="#3b3f45" stroke-width="2.4" stroke-dasharray="12 4 2 4" vector-effect="non-scaling-stroke" />
					{/each}
				{/if}

				<!-- Operating areas: convex hulls of well locations, approximate -->
				{#if layers.areas}
					{#each geom.hulls as hull (hull.key)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<path
							d={hull.d}
							class="hit"
							fill={selectedProperty === hull.key ? 'rgb(14 111 142 / 8%)' : 'rgb(255 255 255 / 62%)'}
							stroke={selectedProperty === hull.key ? 'var(--ops-accent)' : '#1b2127'}
							stroke-width={selectedProperty === hull.key ? 2 : 1.3}
							stroke-dasharray="5 3"
							vector-effect="non-scaling-stroke"
							onpointermove={(e) => showTip(e, PROPERTIES[hull.key].name, 'Operating area (approximate outline around the wells, not a lease line)')}
							onpointerleave={() => (tip = null)}
							onclick={(e) => {
								e.stopPropagation();
								onproperty(hull.key);
							}}
						/>
					{/each}
				{/if}

				<!-- LeaCo land (LeaCo KMZ; BLM) -->
				{#if layers.crawford}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<path
						d={geom.crawford}
						class="hit"
						fill="rgb(255 255 255 / 50%)"
						stroke="#1b2127"
						stroke-width="2"
						stroke-dasharray="7 3"
						fill-rule="evenodd"
						vector-effect="non-scaling-stroke"
						onpointermove={(e) => showTip(e, 'Crawford Ranch', 'LeaCo land, ~2,400 ac · ownership unconfirmed · BLM')}
						onpointerleave={() => (tip = null)}
						onclick={(e) => {
							e.stopPropagation();
							onproperty('crawford');
						}}
					/>
				{/if}
				{#if layers.winkler}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<path
						d={geom.winkler}
						class="hit"
						fill="rgb(255 255 255 / 45%)"
						stroke="#1b2127"
						stroke-width="2"
						fill-rule="evenodd"
						vector-effect="non-scaling-stroke"
						onpointermove={(e) => showTip(e, 'Winkler Ranch', `${data.winklerBoundaryLabel ?? 'LeaCo land'} · LeaCo KMZ`)}
						onpointerleave={() => (tip = null)}
						onclick={(e) => {
							e.stopPropagation();
							onproperty('winkler');
						}}
					/>
				{/if}

				<!-- Routes between areas, and stretches with no mapped road -->
				{#if layers.routes}
					{#each geom.routes as { r, d }, i (i)}
						<path {d} fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<path
							{d}
							class="hit route"
							fill="none"
							stroke-linecap="round"
							stroke-linejoin="round"
							vector-effect="non-scaling-stroke"
							onpointermove={(e) =>
								showTip(e, `${r.from} → ${r.to}`, `${r.miles} mi · via ${r.via.filter((v) => v[1] >= 1).map((v) => v[0]).join(', ')} · not confirmed with LeaCo`)}
							onpointerleave={() => (tip = null)}
							onclick={(e) => openFeature(e, routeInfo(r))}
						/>
					{/each}
					{#each geom.gaps as { g, d }, i (i)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<path
							{d}
							class="hit"
							fill="none"
							stroke="#c53030"
							stroke-width="3"
							stroke-dasharray="5 4"
							vector-effect="non-scaling-stroke"
							onpointermove={(e) => showTip(e, `${g.area}: no mapped road`, `${g.miles} mi from the nearest public road`)}
							onpointerleave={() => (tip = null)}
							onclick={(e) =>
								openFeature(e, {
									title: `${g.area}: unmapped access`,
									source: 'Gap between the property and public roads · U.S. Census TIGER',
									rows: [['Straight-line gap', `${g.miles} mi`]],
									note: {
										head: 'What this means',
										text: 'No public dataset shows a road across this stretch. Access is likely by a lease or ranch road, possibly the state-line road. Lease roads are not traced from imagery.'
									},
									question: 'How does LeaCo physically reach Winkler Ranch, and are there gates? (Open question Q1)'
								})}
						/>
					{/each}
				{/if}

				<!-- State labels -->
				{#if layers.state}
					{#each geom.stateLabelsNS as l, i (i)}
						{#if !l.dense || dense}
							<g transform={symT(l.p)} class="label">
								<text y="-11" text-anchor="middle" class="state">NEW MEXICO ▲</text>
								<text y="17" text-anchor="middle" class="state tx">TEXAS ▼</text>
							</g>
						{/if}
					{/each}
					{#each geom.stateLabelsEW as l, i (i)}
						{#if !l.dense || dense}
							<g transform={symT(l.p)} class="label">
								<text x="-10" text-anchor="end" dominant-baseline="middle" class="state">◀ NEW MEXICO</text>
								<text x="10" dominant-baseline="middle" class="state tx">TEXAS ▶</text>
							</g>
						{/if}
					{/each}
				{/if}

				<!-- XRI delivery point (XRI Water Services Agreement, Annex I) -->
				{#if layers.dp}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<g
						transform={symT(geom.dp)}
						class="hit"
						onpointermove={(e) => showTip(e, 'XRI water delivery point', 'Third-party water enters here · XRI Water Services Agreement, Annex I')}
						onpointerleave={() => (tip = null)}
						onclick={(e) =>
							openFeature(e, {
								title: 'Rhodes Yates Delivery Point',
								source: 'XRI Water Services Agreement, Annex I',
								rows: [
									['Coordinates', '32.017132, -103.147715'],
									['Supply water fee', '$0.265/bbl, paid by XRI to LeaCo']
								],
								note: { head: 'What it is', text: 'Where XRI’s third-party water enters LeaCo’s system.' }
							})}
					>
						<circle r="7" fill="#fff" stroke="#dd6b20" stroke-width="2.5" />
						<circle r="2.6" fill="#dd6b20" />
						<text x="11" y="4" class="dp">XRI delivery point</text>
					</g>
				{/if}

				<!-- Wells, then injectors on top -->
				{#if layers.wells}
					{#each geom.assets.filter((x) => x.a.kind === 'well') as { a, p } (a.key)}
						{@const style = assetStyle(a, period)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<g transform={symT(p)} class="hit" onpointermove={(e) => showTip(e, a.name, assetTip(a))} onpointerleave={() => (tip = null)} onclick={(e) => pickAsset(e, a.key)}>
							<circle r="12" fill="transparent" />
							<AssetGlyph kind="well" {style} selected={selectedAsset === a.key} />
						</g>
					{/each}
				{/if}
				{#if layers.injectors}
					{#each geom.assets.filter((x) => x.a.kind === 'injector') as { a, p } (a.key)}
						{@const style = assetStyle(a, period)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<g transform={symT(p)} class="hit" onpointermove={(e) => showTip(e, a.name, assetTip(a))} onpointerleave={() => (tip = null)} onclick={(e) => pickAsset(e, a.key)}>
							<circle r="12" fill="transparent" />
							<AssetGlyph kind="injector" {style} selected={selectedAsset === a.key} />
						</g>
					{/each}
				{/if}

				<!-- Route mileage tags (above symbols so they stay readable) -->
				{#if layers.routes}
					{#each geom.routes as { r, tag }, i (i)}
						{#if tag}
							{@const text = `${r.miles} mi`}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<g transform={symT(tag)} class="hit" onclick={(e) => openFeature(e, routeInfo(r))}>
								<rect x={-(text.length * 7 + 12) / 2} y="-10" width={text.length * 7 + 12} height="20" rx="10" fill="#5b3cc4" stroke="#fff" stroke-width="1.5" />
								<text y="4.5" text-anchor="middle" class="tag">{text}</text>
							</g>
						{/if}
					{/each}
					{#if dense}
						{#each geom.gaps as { g, tag }, i (i)}
							{@const text = `${g.miles} mi unmapped`}
							<g transform={symT(tag)} class="label">
								<rect x={-(text.length * 6.4 + 12) / 2} y="-10" width={text.length * 6.4 + 12} height="20" rx="10" fill="#fff" stroke="#c53030" stroke-width="1.5" />
								<text y="4.5" text-anchor="middle" class="tag gap">{text}</text>
							</g>
						{/each}
					{/if}
				{/if}

				<!-- Area and ranch labels -->
				{#if layers.areas || layers.wells || layers.injectors}
					{#each geom.hulls as hull (hull.key)}
						<g transform={symT(hull.label)} class="label"><text y="-8" text-anchor="middle" class="area">{PROPERTIES[hull.key].name}</text></g>
					{/each}
				{/if}
				{#if layers.winkler}<g transform={symT(P([-103.205, 31.9935]))} class="label"><text text-anchor="middle" class="area">Winkler Ranch</text></g>{/if}
				{#if layers.crawford}<g transform={symT(P([-103.2785, 32.2615]))} class="label"><text y="4" text-anchor="middle" class="area">Crawford Ranch</text></g>{/if}
			</g>
		</g>
	</svg>

	<!-- Search and go-to -->
	<div class="topbar">
		<!-- method="dialog": an Enter pressed before the page has loaded its scripts does nothing,
		     instead of a plain GET submit that reloads the page. -->
		<form
			class="search"
			role="search"
			method="dialog"
			onsubmit={(e) => {
				e.preventDefault();
				runSearch();
			}}
		>
			<label for="ops-search" class="ops-sr">Find a well or injector</label>
			<input
				id="ops-search"
				bind:this={searchEl}
				bind:value={query}
				list="ops-asset-names"
				placeholder="Find a well (e.g. MLMU 141)  /"
				autocomplete="off"
				onchange={runSearch}
				aria-invalid={searchMiss}
				aria-describedby={searchMiss ? 'ops-search-miss' : undefined}
			/>
			<datalist id="ops-asset-names">
				{#each data.assets as a (a.key)}<option value={a.name}></option>{/each}
			</datalist>
			{#if searchMiss}<span id="ops-search-miss" class="miss" role="status">No match</span>{/if}
		</form>
		<label class="goto">
			<span>Go to</span>
			<select value={selectedProperty ?? 'all'} onchange={(e) => goTo(e.currentTarget.value)}>
				<option value="all">All areas</option>
				{#each PROPERTY_KEYS as k (k)}<option value={k}>{PROPERTIES[k].name}</option>{/each}
			</select>
		</label>
	</div>

	<LayersPanel bind:this={layersPanel} bind:layers counts={{ injectors: data.assets.filter((a) => a.kind === 'injector').length, wells: data.assets.filter((a) => a.kind === 'well').length, routes: data.routes.length }} />

	<!-- View controls -->
	<div class="controls" aria-label="Map view controls" role="group">
		<button type="button" onclick={() => zoomBy(1.6)} aria-label="Zoom in" title="Zoom in (+)">+</button>
		<button type="button" onclick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" title="Zoom out (−)">−</button>
		<button type="button" onclick={resetAll} aria-label="Show all areas" title="Show all areas (0)">
			<svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 5 V1 H5 M9 1 H13 V5 M13 9 V13 H9 M5 13 H1 V9" fill="none" stroke="currentColor" stroke-width="1.7" /></svg>
		</button>
		<button type="button" onclick={() => setRotation(0)} aria-label="Reset rotation to north-up" title="North up (N). Right-drag or Q/E to rotate.">
			<svg width="16" height="26" viewBox="0 0 18 30" aria-hidden="true" style:transform="rotate({rot.a}deg)">
				<path d="M9 2 L15 20 L9 16 L3 20 Z" fill="currentColor" />
				<text x="9" y="29" font-size="9" text-anchor="middle" font-weight="700" fill="currentColor">N</text>
			</svg>
		</button>
	</div>

	{#if BASEMAPS[basemap].credit}<p class="credit">{BASEMAPS[basemap].credit}</p>{/if}

	<div class="scale" aria-hidden="true">
		<span>{bar.label}</span>
		<i style:width="{bar.px}px"></i>
	</div>

	{#if hint}
		<div class="hint" role="status">{hint === 'wheel' ? 'Hold Ctrl (⌘ on Mac) and scroll to zoom the map' : 'Use two fingers to move the map'}</div>
	{/if}

	{#if tip}
		<div class="tip" style:left="{tip.x}px" style:top="{tip.y}px" role="tooltip">
			<b>{tip.title}</b>
			<span>{tip.sub}</span>
		</div>
	{/if}
</div>

<style>
	.map {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--ops-bg);
		/* One finger scrolls the page; two fingers move the map (see the zoom filter). */
		touch-action: pan-y;
	}

	.canvas {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
		user-select: none;
	}

	.canvas:active {
		cursor: grabbing;
	}

	.hit {
		cursor: pointer;
	}

	.label {
		pointer-events: none;
	}

	text {
		font-family: var(--ops-font);
		paint-order: stroke;
		stroke: var(--ops-bg);
		stroke-width: 4px;
		stroke-linejoin: round;
	}

	.area {
		font-size: 13px;
		font-weight: 700;
		fill: var(--ops-ink);
	}

	.state {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.12em;
		fill: #3b3f45;
	}

	.state.tx {
		fill: #7a6232;
	}

	.dp {
		font-size: 11.5px;
		font-weight: 600;
		fill: #9c4211;
		stroke: #fff;
		stroke-width: 3px;
	}

	.topbar {
		position: absolute;
		top: 12px;
		left: 12px;
		right: 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		pointer-events: none;
	}

	.topbar > * {
		pointer-events: auto;
	}

	.search {
		position: relative;
		flex: 0 1 300px;
	}

	.search input,
	.goto {
		width: 100%;
		min-height: 40px;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 10px;
		box-shadow: var(--ops-shadow);
	}

	.search input {
		padding: 0 12px;
	}

	.search input[aria-invalid='true'] {
		border-color: var(--ops-danger);
	}

	.miss {
		position: absolute;
		right: 10px;
		top: 11px;
		font-size: 12px;
		color: var(--ops-danger);
	}

	.goto {
		width: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 4px 0 12px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ops-muted);
	}

	.goto select {
		border: 0;
		background: transparent;
		font-weight: 600;
		color: var(--ops-ink);
		min-height: 36px;
	}

	.route {
		stroke: #5b3cc4;
		stroke-width: 3.6px;
	}

	.route:hover {
		stroke: #3b1f9e;
		stroke-width: 5.5px;
	}

	.tag {
		font-size: 12px;
		font-weight: 700;
		fill: #fff;
		stroke: none;
	}

	.tag.gap {
		font-size: 11.5px;
		fill: #c53030;
	}

	.controls {
		position: absolute;
		right: 12px;
		bottom: 28px;
		display: grid;
		gap: 6px;
	}

	.controls button {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 10px;
		box-shadow: var(--ops-shadow);
		font-size: 20px;
		font-weight: 600;
		color: var(--ops-ink);
	}

	.controls button:hover {
		color: var(--ops-accent);
	}

	.credit {
		position: absolute;
		left: 12px;
		bottom: 50px;
		font-size: 10.5px;
		color: var(--ops-muted);
		background: rgb(255 255 255 / 80%);
		padding: 2px 6px;
		border-radius: 5px;
		pointer-events: none;
	}

	.scale {
		position: absolute;
		left: 12px;
		bottom: 14px;
		display: grid;
		gap: 2px;
		font-size: 11px;
		font-weight: 600;
		color: var(--ops-ink);
		background: rgb(255 255 255 / 80%);
		padding: 3px 6px;
		border-radius: 6px;
	}

	.scale i {
		display: block;
		height: 5px;
		border: 2px solid var(--ops-ink);
		border-top: 0;
	}

	.hint {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(27 33 39 / 35%);
		color: #fff;
		font-size: 16px;
		font-weight: 600;
		pointer-events: none;
		z-index: 6;
		text-align: center;
		padding: 16px;
	}

	.canvas:focus-visible {
		outline: 3px solid var(--ops-accent);
		outline-offset: -3px;
	}

	.tip {
		position: absolute;
		pointer-events: none;
		background: var(--ops-ink);
		color: #fff;
		font-size: 12px;
		line-height: 1.35;
		padding: 6px 9px;
		border-radius: 7px;
		max-width: 300px;
		display: grid;
		z-index: 5;
	}

	.tip span {
		color: #c9ced3;
	}

	@media (max-width: 639px) {
		.topbar {
			right: 120px;
		}
	}
</style>
