<script lang="ts">
	import { appConfig } from '$lib/appConfig';
	import { page } from '$app/state';

	const status = $derived(page.url.searchParams.get('status'));
</script>

<svelte:head>
	<title>Sign in — {appConfig.displayName}</title>
</svelte:head>

<div class="signin">
	<div class="intro">
		<p class="eyebrow">LeaCo Operations</p>
		<h1>What needs fixing, and where, every morning.</h1>
		<p class="lede">Well status, water injected, production and land for every LeaCo property, from Amplified and the daily reports, on one screen.</p>
	</div>

	<section class="card box" aria-labelledby="signin-title">
		<h2 id="signin-title">Sign in</h2>

		{#if status === 'error'}
			<div class="alert alert--error" role="alert">Something went wrong signing in. Please try again.</div>
		{:else if status === 'not_allowed'}
			<div class="alert alert--error" role="alert">
				This Google account isn’t approved. Sign in with your LeaCo account, or ask an admin to add you.
			</div>
		{:else if status === 'signed_out'}
			<div class="alert alert--info" role="status">You’ve been signed out.</div>
		{:else}
			<p class="muted">Use your LeaCo Google Workspace account.</p>
		{/if}

		<a class="button google" href="/api/auth/google/login">
			<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="11" fill="#fff" />
				<path d="M17.6 12.2c0-.4 0-.8-.1-1.2H12v2.3h3.2a2.7 2.7 0 0 1-1.2 1.8v1.5h1.9c1.1-1 1.7-2.5 1.7-4.4Z" fill="#4285F4" />
				<path d="M12 18c1.6 0 2.9-.5 3.9-1.4l-1.9-1.5c-.5.4-1.2.6-2 .6a3.5 3.5 0 0 1-3.3-2.4H6.8v1.5A6 6 0 0 0 12 18Z" fill="#34A853" />
				<path d="M8.7 13.3a3.6 3.6 0 0 1 0-2.6V9.2H6.8a6 6 0 0 0 0 5.6l1.9-1.5Z" fill="#FBBC05" />
				<path d="M12 8.4c.9 0 1.6.3 2.2.9l1.7-1.7A6 6 0 0 0 6.8 9.2l1.9 1.5A3.5 3.5 0 0 1 12 8.4Z" fill="#EA4335" />
			</svg>
			Sign in with Google
		</a>
		<p class="fine">Only approved LeaCo accounts can sign in. An admin sets what each person can see.</p>
	</section>
</div>

<style>
	.signin {
		max-width: 960px;
		margin: 0 auto;
		padding: clamp(32px, 8vh, 96px) 16px 48px;
		display: flex;
		flex-wrap: wrap;
		gap: 32px;
		align-items: center;
	}

	.intro {
		flex: 1 1 380px;
		min-width: 0;
		display: grid;
		gap: 14px;
	}

	.eyebrow {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-500);
	}

	h1 {
		margin: 0;
		font-size: clamp(30px, 2rem + 1vw, 40px);
		line-height: 1.1;
		letter-spacing: -0.025em;
	}

	.lede {
		margin: 0;
		color: var(--ink-700);
		max-width: 460px;
	}

	.box {
		flex: 1 1 340px;
		min-width: 0;
		display: grid;
		gap: 14px;
		padding: 28px;
	}

	.box h2 {
		margin: 0;
		font-size: 22px;
	}

	.box p {
		margin: 0;
	}

	.google {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 50px;
		font-weight: 600;
	}

	.fine {
		font-size: 13px;
		color: var(--ink-500);
	}
</style>
