# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository. Prefer
executable sources over prose: `package.json` for commands, `.github/workflows/deploy.yml`
for release order, `infra/` for AWS resources, the environment root's `web_secret_keys` /
`mcp_secret_keys` for ECS secret keys, `.env.example` for value semantics.

## Project State

Re-derive from disk before assuming otherwise; check the actual files before assuming a
command works.

<!-- Generated from the platform template. Record here: what is built and verified
end-to-end, what is a shell, what is deliberately out of scope and why. Also record the
decisions Play 13 asks for: the MCP_SERVER_TOKEN choice, which scopes replace
DATA_READ / REPORTS_READ and the default grant, and who owns deployment, data and UI. -->

## Human Activation Gate Policy

Specialized agents under `.claude/agents/` are **locked by default**. Before invoking,
delegating to, or performing work assigned to one, Claude must require the user to run that
agent's activation command manually and paste the complete output here. The mechanics are
the `activation-gate` skill; the evidence each agent needs is in its own definition.

Claude must not run an activation or exit command on the user's behalf, simulate or infer
its output, accept "it passed" without the output, substitute another command, reuse a
PASS across tasks, or treat tool access as authorization. Human evidence is authoritative;
the gate exists so a human interacts with the development environment. The sequence is:
name the agent → state LOCKED → show the command → stop → validate the paste → reply
`GATE PASSED — <AGENT> ACTIVATED` or `GATE FAILED — <AGENT> REMAINS LOCKED` → work → exit
gate → `<AGENT> COMPLETE`. The same protocol governs the plays under `playbook/`.

## Agents and skills

Six agents (`architect`, `developer`, `reviewer`, `test-engineer`, `security-reviewer`,
`devops-engineer`) and nine skills (`activation-gate`, `implement-feature`,
`create-api-endpoint`, `database-change`, `debug-issue`, `write-tests`, `review-pr`,
`security-review`, `deploy-check`). Agents are *who*; skills are *how*. There is no
orchestrator agent by design. Use a subagent when work can run independently, isolated
context is valuable, specialist expertise is needed, or workstreams run in parallel. Do not
use one for trivial edits, single-file changes, simple searches, or tightly sequential work
that needs shared context. Claude instructions guide behavior; CI, branch protection and
required PR review enforce policy.

## Where to start

- `playbook/README.md` — the run books. Play 04 is local development; Plays 05–12 stand up
  AWS, UAT and production; Play 14 is day-two operations. Follow them rather than
  improvising, and paste the evidence each play asks for.
- `infra/README.md` — Terraform runbook. **Read before touching any AWS resource.**
- `SECURITY.md` — non-negotiables.

## Environments

Both are AWS ECS Fargate, both defined in Terraform, both running the same image SHA
promoted from one to the other.

| | Production | UAT |
|---|---|---|
| URL | `https://leaco.launchpadinc.org` | `https://leaco-uat.launchpadinc.org` |
| Cluster | `leaco-cluster` | `leaco-uat-cluster` |
| Services | `leaco-web`, `leaco-mcp` | `leaco-uat-web`, `leaco-uat-mcp` |
| Secret | `prod/leaco/app` | `uat/leaco/app` |
| Terraform root | `infra/environments/production` | `infra/environments/uat` |

## Commands

- `pnpm install --frozen-lockfile` — `postinstall` runs SvelteKit sync and `prisma generate`; needs `DATABASE_URL` present (placeholder ok).
- `pnpm dev` / `pnpm run build` / `pnpm run preview` / `pnpm run start`.
- `pnpm run check` — svelte-check. **The primary correctness gate.** There is no linter.
- `pnpm run test:unit` — vitest, `tests/unit/`. Covers the LeaCo data rules (`src/lib/leaco/`) only; there are no route, auth or UI tests yet. The known-good-figures suite needs gitignored `data/private/daily_parsed.json` and skips without it (including in CI). Use `pnpm run test:unit`, not `pnpm exec vitest`, which fails to load in this repo.
- The LeaCo dashboard is the **signed-in home page** (`/`, under the normal app header; `/dashboard` redirects there). It has two modes. **Report mode** (local, when gitignored `data/private/` exists): the daily reports plus a live Amplified panel. **Amplified mode** (UAT/production, or locally with `LEACO_KIT=off`): built from the Amplified API, with public NM OCD fields from `src/lib/leaco/reference/` filling locations, and the LeaCo Daily Reports synced from Dropbox (`documents:ingest`, "Daily Reports" folder) filling water injected, wells running and injectors taking water for the days they cover; anything none of them provides is shown as missing, never estimated (`src/lib/leaco/ops/fromAmplified.ts`). The reports are read from the `Document` tables, not from Dropbox (`src/lib/server/leaco/dropboxReports.ts`, parser `src/lib/leaco/reportText.ts`), so the web container needs no Dropbox keys. The connector (`src/lib/server/leaco/amplifiedSync.ts`) pulls all Amplified wells and leases (~8 GET requests), keeps them in server memory and refreshes them on a 15-min server timer started from the `init` hook in `src/hooks.server.ts`; it needs `AMPLIFIED_API_KEY` in **`web_secret_keys`**.
- `pnpm run amplified:sync` pulls the same data locally (cached in `data/private/amplified/live.json`). `pnpm run reference:build` regenerates the committed public reference (`wells.json`, `layers.json`) from `data/private/`; it copies only public state-record fields and public map layers. `pnpm run amplified:probe` saves raw sample responses. Amplified has no injected-water data: that only comes from the daily reports.
- `pnpm run dev:session` then `pnpm run test:e2e` — Playwright screenshots of the dashboard (home page) at 1440 px and 380 px, failing on console errors (`tests/e2e/`, output in gitignored `.playwright/`). `dev:session` signs in a role-less test user by writing a session row to the **local** database; it refuses any non-localhost `DATABASE_URL`. Local only; not in CI.
- `BUILD_TARGET=docker pnpm run build` — the `adapter-node` output ECS runs. A plain build only exercises `adapter-auto`. Keep both paths.
- `pnpm run test` — **not a test suite**: environment/DB diagnostic. Validates `DATABASE_URL`'s structure (shared rules with `scripts/fix-secret-database-url.sh`) before connecting.
- `pnpm run db:deploy` — apply committed migrations. `db:migrate` is `prisma migrate dev`, only for authoring against a database you own. After schema edits: `db:format`, `db:validate`, `db:generate`.
- `pnpm run mcp:dev` — standalone MCP server on port 3001, matching the deployed two-service shape.
- `pnpm run documents:ingest [-- --dry-run | --force] [--verbose]` — incremental sync of the Dropbox folder (Play 03b, ADR 0003) into the `Document*` tables: new and changed files by content hash, renames/moves update the path only, vanished files marked `REMOVED`. Reads PDF, DOCX, MSG (plus PDF/DOCX/KMZ/MSG attachments) and KMZ; scanned PDFs are `NO_TEXT`. Deployed, run it by hand as a one-off ECS task on the MCP image (`scripts/ingest-documents.ts`); no schedule exists yet. Runs never overlap (`ALREADY_RUNNING`, exit 3). The `document_source_changes` MCP tool does the same diff read-only. In Git Bash, run `scripts/dropbox-auth.sh` as-is (it sets `MSYS_NO_PATHCONV=1`).
- `pnpm run template:check` — zero-hit gate for placeholders, stray identifiers and email addresses.
- `./scripts/smoke-test.sh <base-url> [--skip-redirect] [--db-check <path>]` — the pipeline's promotion gate.

CI gates, in order: `db:validate`, `check`, `test:unit`, `build`. Before pushing also run
`BUILD_TARGET=docker pnpm run build`; CI does not exercise the adapter the containers run.

## Architecture

Four boundaries: **SvelteKit** (UI, server routes, auth boundary), **Prisma + PostgreSQL**
(typed schema, canonical storage), the **MCP server** (read-only tool access), and
**connectors** (source-specific clients following one source → storage → MCP → interface
contract).

- `src/lib/server/mcp/handler.ts` is the shared MCP protocol/auth implementation; it
  imports no domain code and reads env through `process.env` (never `$env`, which the
  standalone process cannot resolve). Tools are the list in `src/lib/server/mcp/tools.ts`.
  A tool returns JSON (one text block). Both entry points pass `mcpInstructions` (from
  `tools.ts`) to `createMcpHandler`, which sends them to clients at connect time; today they
  are the document citation rules (cite file, folder and page with a verbatim quote under
  each claim). Document tools (`src/lib/server/documents/tools.ts`) require the
  `documents:read` scope, which is never the default and must be granted per user.
  `src/routes/api/mcp/+server.ts` is a same-origin fallback; production-equivalent MCP runs
  from `src/mcp-server/index.ts` on port 3001 and serves only `/health` and `/api/mcp`.
  `Dockerfile.mcp` runs through `tsx` and must `COPY` every directory the tools import.
- The ALB routes exact path `/api/mcp` to `mcp` and everything else to `web`. OAuth
  discovery, authorization, consent and token routes stay in SvelteKit.
- **MCP authorization** accepts three principals: a scoped `AgentToken`, a user
  `McpAccessToken` from the OAuth flow, or the legacy `MCP_SERVER_TOKEN` (unrestricted;
  see Play 02 step 4 for the required decision). For OAuth tokens the *effective* scope is
  computed live in `getActiveScopes` (`src/lib/server/mcp/scopes.ts`) as the intersection
  of the token's scopes and the **union** of the user's active `McpUserScopeGrant`s and any
  `McpScope` granted through an active `GroupMembership`, so revocation (direct or via a
  group) applies on the next request. Tools register unconditionally; `guardedToolResult`
  is the gate. This union must never be cached.
- Scopes are the `McpScope` enum plus one map in `src/lib/server/mcp/scopes.ts`. Adding a
  scope is those two edits (plus a migration); the admin UI and discovery follow.
- Site-management capability is a deliberately separate `SitePermission` enum
  (`USERS_MANAGE`, `GROUPS_MANAGE`, `AGENTS_MANAGE`, `CLIENTS_MANAGE`, `ACTIVITY_READ`),
  never wire-mapped and never added to `allScopes` — it must not reach OAuth discovery or
  `/mcp/consent`. Its only source is an active `GroupMembership` on a `Group` holding a
  `GroupPermissionGrant`; there is no per-user permission grant. `Group.isSystem` marks the
  protected `admin` group (undeletable, its `GROUPS_MANAGE`/`USERS_MANAGE` grants
  irrevocable, never left with zero active members — guarded both in
  `src/routes/admin/+page.server.ts` and by two Postgres triggers created in the
  `add_group_permissions` migration). See `docs/decisions/0002-group-based-access-control.md`.
- Admin is one `/admin` route with `?screen=agents|clients|activity|users|groups`; only
  `/admin/users/[id]` is a separate route. `/admin` itself admits any user holding at least
  one `SitePermission`; each screen and action checks its own.
- Svelte 5 runes mode is forced in `vite.config.ts` (there is no `svelte.config.js`):
  `$props`, `$state`, `$derived`, `$effect`, event properties. No legacy syntax.
- `vite.config.ts` disables SvelteKit's origin check because standards-compliant OAuth
  token requests carry no `Origin`. Cookie routes rely on `SameSite=Lax`; token exchange
  relies on PKCE, single-use codes and client/redirect validation. Do not toggle either in
  isolation.
- Identity strings (display name, slug, cookie name, token prefix, storage-key prefix)
  come from `src/lib/appConfig.ts`. `src/app.html` repeats the storage-key prefix because
  it cannot import; keep them equal.

## Environment loading (four mechanisms)

SvelteKit/Vite loads `.env.local` itself; `src/hooks.server.ts` also loads it into
`process.env` for shared server code. The Prisma CLI does not, so `prisma.config.ts` loads
it explicitly. The MCP process (`src/mcp-server/load-env.ts`) and `scripts/test.ts` load it
independently. Every loader uses a path relative to the repository root. A new database
script must load `.env.local` explicitly before importing anything that instantiates Prisma.

Real local values live only in ignored `.env.local`; never print or commit populated env
files. Check presence with `grep -c '^NAME=' .env.local`, never `NAME=.*`.

## Infrastructure (Terraform, `infra/`)

Roots: `bootstrap` (state bucket, local state), `global` (ECR + GitHub OIDC deploy role),
and one per environment copied from `environments/example`.

- **CI owns task-definition revisions.** Services set `ignore_changes = [task_definition]`; `terraform apply` is never a deploy. After changing `image_uris`, an explicit `aws ecs update-service` is still required.
- **Terraform manages secret containers, never values.** No `aws_secretsmanager_secret_version` resource may be added.
- Backends take no variables: `terraform init -backend-config=../my.backend.hcl` (see `infra/example.backend.hcl`).
- Never apply a plan containing a replacement or a destroy without an explicit, recorded decision.
- The activation gate in `infra/modules/environment/ecs.tf` is a `check` block: it warns, it does not refuse. Play 10's evidence rule is the real gate.

## CI/CD Pipeline

`deploy.yml` on push to `uat`: `build → deploy-uat → smoke-test-uat`, then **stops**.
`main` is not a deploy trigger; it is the reviewed, protected branch. Feature work merges
to `uat` to reach the UAT pipeline; `deploy-production.yml` is `workflow_dispatch` only and
promotes an already-built SHA, refusing any SHA not in ECR. Both images are built once and
promoted unchanged. Do not chain production onto the push pipeline.

In each environment: render both task definitions, run `prisma migrate deploy` as a
**blocking one-off `run-task`** (nonzero exit fails the workflow), then roll out both
services. The GitHub environment names `UAT` and `Production` are **not cosmetic**: the
OIDC trust policy checks them in the token subject.

## Database and secrets

One flat JSON secret per environment; ECS injects individual keys via `valueFrom`. The
authoritative key lists are `web_secret_keys` and `mcp_secret_keys` in the environment
root's `variables.tf`. A key listed there but absent from the JSON fails task start; a key
in the JSON but not listed never reaches the container. Nothing enforces the match.

**Both containers read the same `DATABASE_URL`.** ECS resolves secrets at task start, so
a value change reaches a service only on redeploy — always redeploy both.

## Verification limits

State what was verified and how. `svelte-check` proves types, not behavior; a green smoke
test proves liveness, not that a secret value is valid (a broken secret fails the *next*
deploy). RDS is private, so schema and data work runs as one-off ECS tasks. Two
connection-string faults recur: `terraform output db_endpoint` already ends in `:5432`,
and RDS-managed passwords contain `#`/`?`/`|` that must be percent-encoded. When live
state contradicts a document, report both readings rather than "fixing" either.

After any deploy that changes MCP tool definitions, connected MCP clients keep a stale
tool list until they reconnect; the server is stateless per request and cannot push it.

## Security constraints (non-negotiable)

- Connector credentials load server-side only — never in browser-reachable code paths or `PUBLIC_*` variables.
- All database queries are parameterized; validate tool inputs with Zod.
- MCP tools are read-only: no DELETE/UPDATE/INSERT/DROP.
- Logs never contain tokens, connection strings, raw upstream payloads, or sensitive data.
- Environment variables are validated at startup/first use without printing values.

## Git and definition of done

Feature branches only; no direct commits to `main`; a PR with one approving review and
green CI is required. A change is complete when acceptance criteria are satisfied,
`db:validate`, `check`, both builds and any existing tests pass, the relevant
documentation (README, this file, the affected play, `.env.example`, key lists) is
updated, and the agent's exit gate has passed on pasted evidence.

## Working notes

<!-- Team ownership, pinned versions and why, dataset caveats, open decisions. -->

- Versions pinned to current stable: Node 24, pnpm 11, Prisma 7 (driver-adapter via `@prisma/adapter-pg`), Svelte 5 runes, TypeScript 6. Check `pnpm peers check` before bumping.
