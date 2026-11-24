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
	<DashboardScreen dashboard={data.dashboard} />
{:else}
	<div class="page page--narrow">
		<div class="card hero">
			<span class="eyebrow">{appConfig.displayName}</span>
			<h1>Your organization's data, queryable by people and by AI agents</h1>
			<p class="muted">
				Internal data platform with Google Workspace sign-in, admin-granted data scopes, and a
				read-only MCP server that AI clients connect to with OAuth. Sign in with your Workspace
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
