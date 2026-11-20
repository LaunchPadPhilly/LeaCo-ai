<script lang="ts">
	import type { StatusStyle } from '$lib/leaco/ops/status';

	/**
	 * Map symbol for one asset, centred on (0,0). Shape = kind (● well, ▲ injector);
	 * mark = status (filled, ✕, outline, dashed), so color is never the only signal.
	 */
	let { kind, style, selected = false }: { kind: 'well' | 'injector'; style: StatusStyle; selected?: boolean } = $props();

	const hollow = $derived(style.mark === 'outline' || style.mark === 'dashed');
	const fill = $derived(hollow ? '#ffffff' : style.color);
	const stroke = $derived(hollow ? style.color : '#ffffff');
	const dash = $derived(style.mark === 'dashed' ? '2.2 1.6' : undefined);
</script>

{#if selected}<circle r="11" fill="none" stroke="var(--ops-accent)" stroke-width="2.5" />{/if}
{#if kind === 'well'}
	<circle r="5.2" {fill} {stroke} stroke-width={hollow ? 1.8 : 1.4} stroke-dasharray={dash} />
	{#if style.mark === 'cross'}
		<path d="M-2.3 -2.3 L2.3 2.3 M2.3 -2.3 L-2.3 2.3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
	{/if}
{:else}
	<path d="M0 -7.5 L7 5 L-7 5 Z" {fill} {stroke} stroke-width={hollow ? 2 : 1.4} stroke-linejoin="round" stroke-dasharray={dash} />
	{#if style.mark === 'cross'}
		<path d="M-2.2 -1.4 L2.2 3 M2.2 -1.4 L-2.2 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
	{/if}
{/if}
