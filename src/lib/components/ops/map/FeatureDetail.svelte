<script lang="ts">
	import type { FeatureInfo } from '$lib/leaco/ops/feature';

	let { info, onclose }: { info: FeatureInfo; onclose: () => void } = $props();

	let panel: HTMLElement | undefined = $state();
	$effect(() => {
		void info.title;
		panel?.focus({ preventScroll: true });
	});
</script>

<aside class="detail" aria-labelledby="feature-title" bind:this={panel} tabindex="-1">
	<header>
		<div>
			<h2 id="feature-title">{info.title}</h2>
			<p class="sub">{info.source}</p>
		</div>
		<button type="button" class="close" onclick={onclose} aria-label="Close details (Esc)">×</button>
	</header>

	{#if info.rows.length}
		<table class="rows">
			<tbody>
				{#each info.rows as [k, v], i (i)}<tr><th scope="row">{k}</th><td>{v}</td></tr>{/each}
			</tbody>
		</table>
	{/if}

	{#if info.note}
		<section class="note">
			<h3>{info.note.head}</h3>
			<p>{info.note.text}</p>
		</section>
	{/if}

	{#if info.question}
		<p class="question"><b>Open question for LeaCo.</b> {info.question}</p>
	{/if}
</aside>

<style>
	.detail {
		position: absolute;
		/* Below the search / Layers row (52px) so the Layers button never covers the title. */
		top: 62px;
		right: 12px;
		width: min(360px, calc(100% - 24px));
		max-height: calc(100% - 74px);
		overflow-y: auto;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 12px;
		box-shadow: var(--ops-shadow);
		padding: 14px 16px 16px;
		display: grid;
		gap: 12px;
		z-index: 4;
		outline: none;
	}

	header {
		display: flex;
		justify-content: space-between;
		gap: 8px;
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
		width: 55%;
	}

	.rows td {
		padding: 4px 0;
		font-weight: 600;
	}

	.rows tr + tr :is(th, td) {
		border-top: 1px solid var(--ops-sunken);
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
		display: grid;
		gap: 4px;
	}

	.question {
		font-size: 12.5px;
		background: #fbf4e4;
		color: #6b4f15;
		border-left: 3px solid #d39b2a;
		border-radius: 6px;
		padding: 6px 9px;
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
