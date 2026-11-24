<script lang="ts">
	import './ops.css';
	import type { DashboardLoad } from '$lib/leaco/ops/live';
	import Dashboard from './Dashboard.svelte';

	/** The dashboard, or an honest empty state, for the signed-in home page (under the app header). */
	let { dashboard }: { dashboard: DashboardLoad } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{#if dashboard.state === 'ok' && dashboard.ops}
	<Dashboard ops={dashboard.ops} live={dashboard.live} reports={dashboard.reports} reportsNote={dashboard.reportsNote} />
{:else}
	<div class="ops ops-empty">
		<div class="empty-card">
			<p class="ops-eyebrow">LeaCo Operations</p>
			{#if dashboard.state === 'invalid'}
				<h1>The report data couldn’t be read</h1>
				<p>Nothing is shown rather than showing something wrong. {dashboard.reason}</p>
			{:else}
				<h1>No data yet</h1>
				{#if dashboard.reason && /not set/.test(dashboard.reason)}
					<p>
						This environment isn’t connected to Amplified yet: its web service has no Amplified API key. Once the key is added
						(<code>web_secret_keys</code>) and the service redeployed, this page fills in from Amplified.
					</p>
				{:else if dashboard.reason}
					<p>Couldn’t load data from Amplified: {dashboard.reason}</p>
				{:else}
					<p>No LeaCo data is available in this environment yet.</p>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.ops-empty {
		display: grid;
		place-items: start center;
		padding: 48px 16px;
	}

	.empty-card {
		max-width: 480px;
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
</style>
