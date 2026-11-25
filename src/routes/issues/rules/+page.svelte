<script lang="ts">
	import '$lib/components/ops/ops.css';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { appConfig } from '$lib/appConfig';
	import { RULE_DEFS, RULE_KEYS, TICKET_PRIORITIES, defaultRules, type RuleKey } from '$lib/leaco/issues/rules';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Editable copy; the form posts it. Reset to the saved rules after each save.
	let draft = $state(untrack(() => structuredClone(data.rules)));
	$effect(() => {
		draft = structuredClone(data.rules);
	});

	const KIND_OF: Record<RuleKey, string> = {
		well_shutdown: 'SHUTDOWN',
		well_idle: 'IDLE',
		device_offline: 'OFFLINE',
		ticket: 'TICKET',
		injector_stuck: 'STUCK',
		water_drop: 'WATER_DROP',
		report_late: 'REPORT_LATE'
	};
	const groups = [
		{ key: 'wells', title: 'Producing wells · from Amplified' },
		{ key: 'injectors', title: 'Injectors and water · from the daily reports' }
	] as const;
	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(data.rules));
	let busy = $state(false);

	function parts(sentence: string) {
		const i = sentence.search(/\{n\}|\{option\}/);
		if (i < 0) return { before: sentence, field: null as 'n' | 'option' | null, after: '' };
		const field = sentence.slice(i).startsWith('{n}') ? 'n' : 'option';
		return { before: sentence.slice(0, i), field, after: sentence.slice(i + (field === 'n' ? 3 : 8)) };
	}
</script>

<svelte:head>
	<title>Issue rules · {appConfig.displayName}</title>
</svelte:head>

<div class="ops rules">
	<main class="body">
		<nav class="crumb" aria-label="Breadcrumb"><a href="/issues">Issues</a> / <span aria-current="page">Rules</span></nav>
		<div class="title">
			<h1>When to open an issue</h1>
			<p>These rules decide what lands on “Needs a contractor”. They apply to everyone at LeaCo.{data.canChange ? '' : ' Only admins can change them.'}</p>
		</div>

		{#if form?.message}<p class="banner bad" role="alert">{form.message}</p>{/if}
		{#if form && 'done' in form && form.done}<p class="banner ok" role="status">{form.done}</p>{/if}

		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: false });
					busy = false;
				};
			}}
		>
			{#each groups as g (g.key)}
				<section class="group" aria-labelledby="g-{g.key}">
					<h2 id="g-{g.key}" class="ops-eyebrow">{g.title}</h2>
					{#each RULE_KEYS.filter((k) => RULE_DEFS[k].group === g.key) as k (k)}
						{@const def = RULE_DEFS[k]}
						{@const p = parts(def.sentence)}
						{@const open = data.openByKind[KIND_OF[k]] ?? 0}
						<div class="rule" class:off={!draft[k].enabled}>
							<label class="switch">
								<input type="checkbox" name="{k}.enabled" bind:checked={draft[k].enabled} disabled={!data.canChange} aria-label="Rule on: {def.title}" />
								<span class="track" aria-hidden="true"><span class="knob"></span></span>
							</label>
							<div class="main">
								<h3>{def.title}</h3>
								<div class="sentence">
									<span>{p.before}</span>
									{#if p.field === 'n'}
										<input
											type="number"
											name="{k}.threshold"
											min={def.min}
											max={def.max}
											step="1"
											bind:value={draft[k].threshold}
											disabled={!data.canChange || !draft[k].enabled}
											aria-label="{def.title}: {def.unit}"
										/>
									{:else if p.field === 'option'}
										<select name="{k}.option" bind:value={draft[k].option} disabled={!data.canChange || !draft[k].enabled} aria-label="{def.title}: priority">
											{#each TICKET_PRIORITIES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
										</select>
									{/if}
									<span>{p.after}</span>
								</div>
								{#if !draft[k].enabled && p.field === 'n'}<input type="hidden" name="{k}.threshold" value={draft[k].threshold ?? ''} />{/if}
								{#if !draft[k].enabled && p.field === 'option'}<input type="hidden" name="{k}.option" value={draft[k].option ?? ''} />{/if}
								<p class="help">{def.help}</p>
							</div>
							<span class="count">{draft[k].enabled ? `${open} open now` : 'Off'}</span>
						</div>
					{/each}
				</section>
			{/each}

			{#if data.canChange}
				<div class="save">
					<button type="button" class="btn" onclick={() => (draft = defaultRules())}>Reset to defaults</button>
					<button type="submit" class="btn primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save rules'}</button>
				</div>
			{/if}
		</form>
		<p class="foot">Changes are recorded in the activity log. A rule change never deletes issues people have acted on; issues that no longer match close as resolved.</p>
	</main>
</div>

<style>
	.rules {
		min-height: auto;
	}

	.body {
		max-width: 1000px;
		margin: 0 auto;
		padding: 24px clamp(16px, 2.5vw, 28px) 40px;
		display: grid;
		gap: 16px;
	}

	.crumb {
		font-size: 14px;
		color: var(--ops-muted);
	}

	a {
		color: var(--ops-accent);
		font-weight: 600;
	}

	.title h1 {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.title p {
		margin-top: 4px;
		color: var(--ops-muted);
	}

	form {
		display: grid;
		gap: 16px;
	}

	.banner {
		padding: 10px 14px;
		border-radius: 10px;
		font-size: 14px;
	}

	.banner.bad {
		background: var(--ops-danger-soft);
		color: var(--ops-danger-ink);
	}

	.banner.ok {
		background: var(--ops-good-soft);
		color: var(--ops-good);
	}

	.group {
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		overflow: hidden;
	}

	.group h2 {
		padding: 14px 18px;
	}

	.rule {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) auto;
		gap: 16px;
		align-items: center;
		padding: 16px 18px;
		border-top: 1px solid var(--ops-divider);
	}

	.rule.off h3,
	.rule.off .sentence {
		color: var(--ops-muted);
	}

	h3 {
		font-size: 15.5px;
		font-weight: 650;
	}

	.sentence {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 8px;
		font-size: 14.5px;
	}

	.sentence input,
	.sentence select {
		min-height: 40px;
		width: 76px;
		padding: 0 8px;
		border: 1px solid #c9c4b8;
		border-radius: 6px;
		background: #fff;
		font-family: var(--ops-mono);
	}

	.sentence select {
		width: auto;
		font-family: inherit;
	}

	.help {
		margin-top: 4px;
		font-size: 13px;
		color: var(--ops-muted);
	}

	.count {
		font-size: 13px;
		color: var(--ops-ink-2);
		white-space: nowrap;
	}

	.switch {
		position: relative;
		width: 48px;
		height: 28px;
		cursor: pointer;
	}

	.switch input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}

	.track {
		display: block;
		width: 48px;
		height: 28px;
		border-radius: 999px;
		background: #c9c4b8;
		position: relative;
		transition: background 0.15s;
	}

	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
		transition: left 0.15s;
	}

	.switch input:checked + .track {
		background: var(--ops-accent);
	}

	.switch input:checked + .track .knob {
		left: 23px;
	}

	.switch input:focus-visible + .track {
		outline: 2.5px solid var(--ops-accent);
		outline-offset: 2px;
	}

	.switch input:disabled {
		cursor: default;
	}

	.save {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		position: sticky;
		bottom: 0;
		padding: 12px 0;
		background: linear-gradient(transparent, var(--ops-bg) 30%);
	}

	.btn {
		min-height: 46px;
		padding: 0 18px !important;
		border: 1px solid var(--ops-line) !important;
		border-radius: 8px;
		background: var(--ops-panel) !important;
		font-weight: 600;
	}

	.btn.primary {
		background: var(--ops-accent) !important;
		border-color: var(--ops-accent) !important;
		color: #fff;
	}

	.btn:disabled {
		opacity: 0.55;
	}

	.foot {
		font-size: 13px;
		color: var(--ops-muted);
	}

	@media (max-width: 640px) {
		.rule {
			grid-template-columns: minmax(0, 1fr) 52px;
		}

		.switch {
			grid-column: 2;
			grid-row: 1;
		}

		.main {
			grid-column: 1;
			grid-row: 1;
		}

		.count {
			grid-column: 1 / -1;
		}

		.save .btn {
			flex: 1;
		}
	}
</style>
