<script lang="ts">
	import { appConfig } from '$lib/appConfig';
	import DashboardScreen from '$lib/components/ops/DashboardScreen.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.signedIn ? `LeaCo Operations · ${appConfig.displayName}` : appConfig.displayName}</title>
</svelte:head>

{#if data.signedIn}
	<!-- Signed-in home is the LeaCo operations dashboard, under the normal app header. -->
	<DashboardScreen dashboard={data.dashboard} setAside={data.setAside} />
{:else}
	<div class="page page--narrow">
		<div class="card hero">
			<span class="eyebrow">LeaCo Operations</span>
			<h1>What needs fixing, and where, every morning.</h1>
			<p class="muted">
				Well status, water injected, production and land for every LeaCo property, from
				Amplified and the daily reports, on one screen. Sign in with your LeaCo Google Workspace
				account to continue.
			</p>
			<a class="button" href="/api/auth/google/login">Sign in with Google</a>
		</div>
	</div>
{/if}

<style>
	.hero {
		text-align: left;
	}

	.hero h1 {
		font-size: var(--fs-display);
	}
</style>
