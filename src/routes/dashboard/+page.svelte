<script lang="ts">
	import '$lib/components/ops/ops.css';
	import Dashboard from '$lib/components/ops/Dashboard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>LeaCo Operations</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{#if data.state === 'ok' && data.ops}
	<Dashboard ops={data.ops} live={data.live} />
{:else}
	<div class="ops ops-screen ops-empty">
		<div class="empty-card">
			<p class="ops-eyebrow">LeaCo Operations</p>
			{#if data.state === 'invalid'}
				<h1>The report data couldn’t be read</h1>
				<p>Nothing is shown rather than showing something wrong. {data.reason}</p>
			{:else}
				<h1>No data yet</h1>
				<p>This environment has no LeaCo reports loaded. The dashboard fills in once the Amplified data sync is connected.</p>
			{/if}
			<a href="/">← Back to the app</a>
		</div>
	</div>
{/if}

<style>
	.ops-empty {
		display: grid;
		place-items: center;
		padding: 16px;
	}

	.empty-card {
		max-width: 440px;
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 12px;
		padding: 20px;
		display: grid;
		gap: 10px;
	}

	.empty-card h1 {
		font-size: 20px;
		font-weight: 700;
	}

	.empty-card a {
		color: var(--ops-accent);
		font-weight: 600;
	}
</style>
