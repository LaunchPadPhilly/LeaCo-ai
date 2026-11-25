<script lang="ts">
	import '$lib/components/ops/ops.css';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { appConfig } from '$lib/appConfig';
	import { dayText, KIND_GLYPH, KIND_LABEL, REASON_LABEL, REASONS, sinceText } from '$lib/leaco/issues/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Tab = 'open' | 'sent' | 'archived' | 'resolved';
	const TABS: { key: Tab; label: string; status: string }[] = [
		{ key: 'open', label: 'Open', status: 'OPEN' },
		{ key: 'sent', label: 'Contractor sent', status: 'CONTRACTOR_SENT' },
		{ key: 'archived', label: 'Archived', status: 'ARCHIVED' },
		{ key: 'resolved', label: 'Resolved, last 7 days', status: 'RESOLVED' }
	];
	const tab = $derived<Tab>((TABS.find((t) => t.key === page.url.searchParams.get('tab'))?.key ?? 'open') as Tab);
	const counts = $derived(Object.fromEntries(TABS.map((t) => [t.key, data.issues.filter((i) => i.status === t.status).length])) as Record<Tab, number>);
	const rows = $derived(
		data.issues
			.filter((i) => i.status === TABS.find((t) => t.key === tab)!.status)
			.sort((a, b) => (tab === 'resolved' ? (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '') : a.firstSeenAt.localeCompare(b.firstSeenAt)))
	);

	let selected = $state<string[]>([]);
	/** Ids the archive panel will archive; null when it's closed. */
	let archiving = $state<string[] | null>(null);
	let reason = $state<string>('NOT_URGENT');
	let returnOn = $state('');
	let note = $state('');
	let busy = $state(false);

	$effect(() => {
		void tab;
		selected = [];
		archiving = null;
	});

	const nameOf = (id: string) => data.issues.find((i) => i.id === id)?.assetName ?? '';
	const archiveTitle = $derived(archiving ? (archiving.length === 1 ? `Archive ${nameOf(archiving[0])}?` : `Archive ${archiving.length} issues?`) : '');

	function openArchive(ids: string[]) {
		archiving = ids;
		reason = 'NOT_URGENT';
		returnOn = '';
		note = '';
	}
	const toggle = (id: string, on: boolean) => (selected = on ? [...selected, id] : selected.filter((s) => s !== id));
	const allOn = $derived(rows.length > 0 && rows.every((r) => selected.includes(r.id)));

	const submitted = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
			selected = [];
			archiving = null;
		};
	};
</script>

<svelte:head>
	<title>Issues · {appConfig.displayName}</title>
</svelte:head>

<div class="ops issues">
	<main class="body">
		<div class="title">
			<h1>Issues</h1>
			<p>
				Everything the Overview flags.{data.canChange ? ' Mark what you’ve sent a contractor to, and archive what doesn’t need a truck today.' : ''} An archived issue comes back by itself if it gets worse or on its return date.
				<a href="/issues/rules">{data.canChange ? 'Change when issues open' : 'When issues open'}</a>
			</p>
		</div>

		{#if form?.message}<p class="banner bad" role="alert">{form.message}</p>{/if}
		{#if form && 'done' in form && form.done}<p class="banner ok" role="status">{form.done}</p>{/if}
		{#if !data.canChange}<p class="banner info">You can see issues; only admins can change their status.</p>{/if}

		<nav class="tabs" aria-label="Issue status">
			{#each TABS as t (t.key)}
				<a href="?tab={t.key}" aria-current={tab === t.key ? 'page' : undefined} data-sveltekit-noscroll>
					{t.label} <span class="ops-num" class:hot={t.key === 'open' && counts.open > 0}>{counts[t.key]}</span>
				</a>
			{/each}
		</nav>

		<div class="layout" class:with-panel={archiving !== null}>
			<section class="list" aria-label="{TABS.find((t) => t.key === tab)?.label} issues">
				{#if data.canChange && selected.length && tab !== 'resolved'}
					<div class="bulk" role="toolbar" aria-label="Selected issues">
						<b>{selected.length} selected</b>
						{#if tab !== 'sent'}
							<form method="POST" action="?/contractor" use:enhance={submitted}>
								{#each selected as id (id)}<input type="hidden" name="id" value={id} />{/each}
								<button type="submit" class="btn" disabled={busy}>Mark contractor sent</button>
							</form>
						{/if}
						{#if tab !== 'archived'}<button type="button" class="btn" onclick={() => openArchive([...selected])}>Archive…</button>{/if}
						{#if tab !== 'open'}
							<form method="POST" action="?/back" use:enhance={submitted}>
								{#each selected as id (id)}<input type="hidden" name="id" value={id} />{/each}
								<button type="submit" class="btn" disabled={busy}>Bring back</button>
							</form>
						{/if}
						<button type="button" class="btn ghost" onclick={() => (selected = [])}>Clear</button>
					</div>
				{/if}

				{#if rows.length === 0}
					<div class="empty">
						{#if tab === 'open'}
							<span class="tick" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5 9-10" /></svg></span>
							<p><b>All clear right now.</b> Nothing needs a contractor.</p>
						{:else}
							<p>None.</p>
						{/if}
					</div>
				{:else}
					{#if data.canChange && tab !== 'resolved'}
						<label class="selectall"><input type="checkbox" checked={allOn} onchange={(e) => (selected = e.currentTarget.checked ? rows.map((r) => r.id) : [])} /> Select all {rows.length}</label>
					{/if}
					<ul>
						{#each rows as r (r.id)}
							{@const g = KIND_GLYPH[r.kind]}
							<li class:sel={selected.includes(r.id)} class:nopick={!(data.canChange && tab !== 'resolved')}>
								{#if data.canChange && tab !== 'resolved'}
									<input type="checkbox" class="pick" aria-label="Select {r.assetName}" checked={selected.includes(r.id)} onchange={(e) => toggle(r.id, e.currentTarget.checked)} />
								{/if}
								<span class="glyph {g.tone} {g.shape}" aria-hidden="true">{g.mark}</span>
								<span class="who">
									<b>{r.assetName}</b>
									{#if r.property}<span class="small">{r.property}</span>{/if}
								</span>
								<span class="what">
									<span><b class="state {g.tone}">{KIND_LABEL[r.kind]}</b> · {r.detail.length > 140 ? `${r.detail.slice(0, 138).trimEnd()}…` : r.detail}</span>
									<span class="small">
										{#if tab === 'archived' && r.archiveReason}{REASON_LABEL[r.archiveReason]}{r.returnOn ? ` · back ${dayText(r.returnOn)}` : ''} · {/if}
										{#if r.note}“{r.note}” · {/if}
										{r.source}
									</span>
								</span>
								<span class="when small">
									{#if tab === 'resolved' && r.resolvedAt}resolved {sinceText(r.resolvedAt)} ago{:else}{@const s = sinceText(r.firstSeenAt)}first seen {s === 'just now' ? s : `${s} ago`}{/if}
								</span>
								{#if data.canChange && tab !== 'resolved'}
									<span class="acts">
										{#if tab === 'open'}
											<form method="POST" action="?/contractor" use:enhance={submitted}>
												<input type="hidden" name="id" value={r.id} />
												<button type="submit" class="btn" disabled={busy}>Contractor sent</button>
											</form>
										{/if}
										{#if tab !== 'archived'}<button type="button" class="btn" onclick={() => openArchive([r.id])}>Archive…</button>{/if}
										{#if tab !== 'open'}
											<form method="POST" action="?/back" use:enhance={submitted}>
												<input type="hidden" name="id" value={r.id} />
												<button type="submit" class="btn" disabled={busy}>Bring back</button>
											</form>
										{/if}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if archiving}
				<aside class="panel" aria-labelledby="archive-title">
					<form method="POST" action="?/archive" use:enhance={submitted}>
						{#each archiving as id (id)}<input type="hidden" name="id" value={id} />{/each}
						<div class="phead">
							<h2 id="archive-title">{archiveTitle}</h2>
							<button type="button" class="x" aria-label="Close" onclick={() => (archiving = null)}>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
							</button>
						</div>
						<fieldset>
							<legend>Why doesn’t it need attention now?</legend>
							{#each REASONS as r (r.value)}
								<label class="radio" class:on={reason === r.value}>
									<input type="radio" name="reason" value={r.value} bind:group={reason} />
									<span>{r.label}{#if r.hint}<span class="small">{r.hint}</span>{/if}</span>
								</label>
							{/each}
						</fieldset>
						<fieldset>
							<legend>Bring it back</legend>
							<p class="small">Always, if it gets worse.</p>
							<label class="date">On <input type="date" name="returnOn" bind:value={returnOn} min={new Date().toISOString().slice(0, 10)} /> <span class="small">(optional)</span></label>
						</fieldset>
						<label class="note">Note <span class="small">(optional)</span><textarea name="note" rows="2" maxlength="500" bind:value={note}></textarea></label>
						<div class="pacts">
							<button type="submit" class="btn primary" disabled={busy}>Archive</button>
							<button type="button" class="btn" onclick={() => (archiving = null)}>Cancel</button>
						</div>
						<p class="small">Archiving only takes it off “Needs a contractor”. The well’s status on the map and in the numbers doesn’t change. Who archived it, and why, goes in the activity log.</p>
					</form>
				</aside>
			{/if}
		</div>

		<section class="flow" aria-labelledby="flow-title">
			<h2 id="flow-title" class="ops-eyebrow">How an issue moves</h2>
			<div class="steps">
				<div class="step open"><b>Open</b><p>Opened automatically when a rule matches: a well shuts down, an injector stops taking water, a ticket opens.</p></div>
				<div class="step sent"><b>Contractor sent</b><p>Someone is on it. Off the urgent list but kept here.</p></div>
				<div class="step res"><b>Resolved</b><p>Closes by itself when the data shows it fixed: the well running again, water going in.</p></div>
				<div class="step arch"><b>Archived</b><p>Doesn’t need a truck now. Comes back if it gets worse, or on its return date.</p></div>
			</div>
		</section>
	</main>
</div>

<style>
	.issues {
		min-height: auto;
	}

	.body {
		max-width: 1360px;
		margin: 0 auto;
		padding: 24px clamp(16px, 2.5vw, 28px) 40px;
		display: grid;
		gap: 18px;
	}

	.title h1 {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.title p {
		margin-top: 4px;
		color: var(--ops-muted);
		font-size: 15px;
		max-width: 820px;
	}

	a {
		color: var(--ops-accent);
		font-weight: 600;
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

	.banner.info {
		background: var(--ops-accent-soft);
		color: var(--ops-accent-hover);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		border-bottom: 1px solid var(--ops-line);
	}

	.tabs a {
		padding: 10px 14px;
		margin-bottom: -1px;
		color: var(--ops-ink-2);
		font-weight: 500;
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}

	.tabs a[aria-current='page'] {
		color: var(--ops-ink);
		font-weight: 600;
		border-bottom-color: var(--ops-accent);
	}

	.tabs .ops-num {
		color: var(--ops-muted);
	}

	.tabs .hot {
		color: var(--ops-danger);
	}

	.layout {
		display: grid;
		gap: 20px;
		align-items: start;
	}

	.layout.with-panel {
		grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
	}

	.list {
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: var(--ops-radius);
		overflow: hidden;
		min-width: 0;
	}

	.bulk {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: var(--ops-accent-soft);
		border-bottom: 1px solid #c7dce3;
		color: var(--ops-accent-hover);
	}

	.selectall {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		font-size: 13px;
		color: var(--ops-muted);
	}

	ul {
		display: grid;
	}

	li {
		display: grid;
		grid-template-columns: auto 26px minmax(0, 1fr) minmax(0, 2fr) auto auto;
		gap: 12px;
		align-items: center;
		padding: 12px 16px;
		border-top: 1px solid var(--ops-divider);
	}

	li.nopick {
		grid-template-columns: 26px minmax(0, 1fr) minmax(0, 2fr) auto auto;
	}

	li.sel {
		background: #f2f8fa;
	}

	.pick,
	.selectall input {
		width: 18px;
		height: 18px;
		accent-color: var(--ops-accent);
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
	}

	.glyph.circle {
		border-radius: 50%;
	}

	.glyph.square {
		border-radius: 5px;
	}

	.glyph.danger {
		background: var(--ops-danger);
	}

	.glyph.warn {
		background: var(--ops-warn-fill);
	}

	.glyph.offline {
		background: var(--ops-offline);
	}

	.who,
	.what {
		display: grid;
		gap: 1px;
		min-width: 0;
		font-size: 14.5px;
	}

	.small {
		display: block;
		font-size: 13px;
		color: var(--ops-muted);
		font-weight: 400;
	}

	.when {
		white-space: nowrap;
	}

	.state.danger {
		color: var(--ops-danger);
	}

	.state.warn {
		color: var(--ops-warn);
	}

	.state.offline {
		color: var(--ops-ink-2);
	}

	.acts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 12px !important;
		border: 1px solid var(--ops-line) !important;
		border-radius: 6px;
		background: var(--ops-panel) !important;
		font-size: 14px;
		font-weight: 600;
		color: var(--ops-ink);
		white-space: nowrap;
	}

	.btn:hover:not(:disabled) {
		border-color: var(--ops-accent) !important;
		color: var(--ops-accent);
	}

	.btn:disabled {
		opacity: 0.6;
	}

	.btn.ghost {
		border-color: transparent !important;
		background: transparent !important;
		color: var(--ops-accent-hover);
	}

	.btn.primary {
		background: var(--ops-accent) !important;
		border-color: var(--ops-accent) !important;
		color: #fff;
		flex: 1;
		justify-content: center;
		min-height: 46px;
	}

	.empty {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 22px 18px;
	}

	.tick {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--ops-good-soft);
		color: var(--ops-good);
	}

	.panel {
		background: var(--ops-panel);
		border: 2px solid var(--ops-accent);
		border-radius: var(--ops-radius);
		padding: 18px;
		box-shadow: var(--ops-shadow-float);
		position: sticky;
		top: 16px;
	}

	.panel form {
		display: grid;
		gap: 14px;
	}

	.phead {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}

	.phead h2 {
		font-size: 19px;
		font-weight: 650;
	}

	.x {
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	legend {
		font-weight: 600;
		margin-bottom: 8px;
		font-size: 14.5px;
	}

	.radio {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border: 1px solid var(--ops-line);
		border-radius: 8px;
		cursor: pointer;
		font-size: 14.5px;
	}

	.radio.on {
		border-color: var(--ops-accent);
		background: #f2f8fa;
	}

	.radio input {
		margin-top: 3px;
		accent-color: var(--ops-accent);
	}

	.date {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 14.5px;
	}

	.date input,
	textarea {
		min-height: 40px;
		padding: 6px 10px;
		border: 1px solid var(--ops-line);
		border-radius: 6px;
		font: inherit;
		background: #fff;
	}

	.note {
		display: grid;
		gap: 6px;
		font-weight: 600;
		font-size: 14.5px;
	}

	textarea {
		font-weight: 400;
		resize: vertical;
	}

	.note .small,
	.date .small {
		display: inline;
	}

	.pacts {
		display: flex;
		gap: 10px;
	}

	.flow {
		display: grid;
		gap: 10px;
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}

	.step {
		--step: var(--ops-offline);
		background: var(--ops-panel);
		border: 1px solid var(--ops-line);
		border-radius: 10px;
		padding: 14px;
		font-size: 14px;
	}

	.step b {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.step b::before {
		content: '';
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--step);
	}

	.step p {
		margin-top: 4px;
		color: var(--ops-ink-2);
	}

	.step.open {
		--step: var(--ops-danger);
	}

	.step.sent {
		--step: var(--ops-warn-fill);
	}

	.step.res {
		--step: var(--ops-good);
	}

	@media (max-width: 1000px) {
		.layout.with-panel {
			grid-template-columns: minmax(0, 1fr);
		}

		.panel {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			top: auto;
			z-index: 50;
			max-height: 85vh;
			overflow-y: auto;
			border-radius: 16px 16px 0 0;
			border-width: 1px;
		}
	}

	@media (max-width: 760px) {
		li {
			grid-template-columns: auto 24px minmax(0, 1fr);
			padding: 12px 14px;
		}

		li.nopick {
			grid-template-columns: 24px minmax(0, 1fr);
		}

		.what,
		.when,
		.acts {
			grid-column: -2;
		}

		.acts {
			justify-content: flex-start;
		}

		.btn {
			min-height: 44px;
		}
	}
</style>
