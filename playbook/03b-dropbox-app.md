# Play 03b — Dropbox app and refresh token (document source)

**Goal:** a Dropbox API app with read-only scopes, one long-lived **refresh token** issued
by a dedicated Dropbox account that can see the client's folder, and a verified listing of
that folder from your machine. This is the Dropbox counterpart of the Google Drive service
account in ADR 0001. It is a **document source** only; sign-in still uses Google (Play 03),
unchanged.

**Needs:** Play 02 closed. `curl` and `jq` installed (Play 01). The client available to
share a folder and, if they are on Dropbox Business/Teams, their Dropbox admin reachable.

**Why it differs from Google Drive:** Dropbox has no service account. The nearest
equivalent is an ordinary Dropbox account that exists only for this integration, and that
the client shares their folder with, exactly as they would with a person. Our app gets a
refresh token for that account once, through a one-time consent, and exchanges it for a
short-lived (about 4 hours) access token on each run. The refresh token does not expire on
a timer; it stops working only if it is revoked or the app is unlinked.

No secret value may appear in the chat during this play. The helper script
`scripts/dropbox-auth.sh` reads secrets silently and prints only non-secret results.

## Steps

### 1. Decide the account and confirm the folder's location

Ask the client, and record the answers in the chat:

1. **Which account issues the token.** Recommended: a dedicated account (for example
   `ai-reader@<client domain>`) with nothing in it except what is shared to it. The app
   uses *Full Dropbox* access (step 2), so it can read **everything that account can
   see**. A dedicated account limits that to the shared folder. Using a staff member's
   personal account exposes their whole Dropbox and breaks when they leave.
2. **Personal/Plus vs. Business/Teams.** If Business/Teams: is the folder in the **team
   space** (a team folder) or in someone's own folder? Team-space folders need the
   `Dropbox-API-Path-Root` header (step 5 detects this), and the client's admin may
   restrict sharing outside the team or third-party app linking.
3. **The folder path** as seen from the dedicated account once shared, for example
   `/LeaCo Programs`.

**EVIDENCE 03b.1** — the three answers, in words.
**Accept when:** the token account is named (a dedicated account, or an explicit decision
otherwise with the reason); the plan type is stated; a folder path is given.

### 2. Create the Dropbox app

Signed in as the **developer** (your own Dropbox, not the client's), at
<https://www.dropbox.com/developers/apps> → **Create app**:

- **Choose an API:** Scoped access.
- **Type of access:** **Full Dropbox**. Do not pick *App folder*: that only reaches
  `/Apps/<app name>/`, and the client's existing folder would have to be moved into it.
- **Name:** `<slug>-document-reader` (must be globally unique; adjust if taken).

Then, on the app's **Permissions** tab, tick **only**:

- `files.metadata.read`
- `files.content.read`

(`account_info.read` is always on and cannot be removed.) Click **Submit**.

**Set the permissions before step 3.** A token keeps the scopes it was issued with. If
you change permissions later, you must repeat step 3 to get a token with the new ones.

Leave the app in **Development** status. Only one account (the dedicated one) will ever
link it, so there is no reason to apply for Production.

On the **Settings** tab, copy the **App key** and **App secret** into your password
manager. The app key is not secret. **The app secret is.**

**EVIDENCE 03b.2** — paste the app key, the access type, and the ticked permissions as
listed on the Permissions tab.
**Accept when:** access type is Full Dropbox; the only write-capable scope is none (no
`files.content.write`, no `sharing.write`, no `file_requests.write`); the two read scopes
above are ticked.

### 3. Share the folder with the dedicated account

The client shares the folder from step 1 with the dedicated account as **Can view**.
Sign in to Dropbox **as the dedicated account** and accept the share. On non-team plans the
folder only appears in that account's namespace (and so to the API) after it is accepted
and added to its Dropbox.

**EVIDENCE 03b.3** — confirmation in words that the share was accepted, and the folder
path exactly as it appears in the dedicated account's Dropbox.
**Accept when:** the folder is visible in the dedicated account's file browser. If the
client's share UI reported an error, record it verbatim. Do not guess at their tenant
policy from our side.

### 4. Issue the refresh token

Put the app key and secret into `.env.local` first (the script reads them from there, and
prompts silently for any that are missing):

```bash
grep -c '^DROPBOX_APP_KEY=' .env.local
grep -c '^DROPBOX_APP_SECRET=' .env.local
```

Then, in a private browser window **signed in to Dropbox as the dedicated account**, run:

```bash
./scripts/dropbox-auth.sh authorize
```

The script prints an authorize URL. Open it in that window and click **Allow**. Dropbox
shows a one-time code. Paste it into the script's hidden prompt, not into the chat. The
code expires within minutes and works once only. If the exchange fails, run the command
again. The script writes `DROPBOX_REFRESH_TOKEN` into `.env.local` with mode 600 and prints
only the granted scopes and a confirmation.

**EVIDENCE 03b.4** — paste the script's output.
**Accept when:** `REFRESH_TOKEN_SAVED`; `scope=` lists `files.metadata.read` and
`files.content.read` (and `account_info.read`) and nothing else; no token, code or secret
is visible.

### 5. Verify from your machine

Add the folder path to `.env.local` as `DROPBOX_ROOT_PATH=/LeaCo Programs` (your path from
step 3), then:

```bash
./scripts/dropbox-auth.sh verify
```

It refreshes an access token, identifies the account type, resolves the folder, and
counts what is directly inside it. It prints no file names.

**EVIDENCE 03b.5** — paste the full output.
**Accept when:**

- `token_refresh=ok`
- `account_type=` matches step 1 (`basic`, `pro`, or `business`)
- `folder=found` and `folder_id=id:...` are present. Copy `folder_id` into `.env.local` as
  `DROPBOX_ROOT_FOLDER_ID`. Unlike the path, it survives a rename or move of the folder.
- The `entries` counts are non-zero, unless the client confirms the folder is empty.
- If it prints `team_space=yes`, also copy the printed `DROPBOX_PATH_ROOT_NAMESPACE_ID`
  line into `.env.local`. The connector must send it, or team folders list as empty.

### 6. UAT secret (only once the Dropbox connector code has merged)

Do not do this step before the connector ships. Order matters: put the keys **into the
secret first**, then add them to `mcp_secret_keys` in `infra/environments/uat/variables.tf`.
If ECS is told to inject a key the secret does not hold, the `mcp` task fails to start.

```bash
umask 077; F="$(mktemp /tmp/uat-secret-update.XXXXXX)"
aws secretsmanager get-secret-value --secret-id uat/<slug>/app --query SecretString --output text > "$F"
get() { grep "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/'; }
jq --arg k "$(get DROPBOX_APP_KEY)" --arg s "$(get DROPBOX_APP_SECRET)" \
   --arg r "$(get DROPBOX_REFRESH_TOKEN)" --arg f "$(get DROPBOX_ROOT_FOLDER_ID)" \
   --arg n "$(get DROPBOX_PATH_ROOT_NAMESPACE_ID)" \
   '.DROPBOX_APP_KEY=$k | .DROPBOX_APP_SECRET=$s | .DROPBOX_REFRESH_TOKEN=$r
    | .DROPBOX_ROOT_FOLDER_ID=$f | .DROPBOX_PATH_ROOT_NAMESPACE_ID=$n
    | .DOCUMENT_SOURCE_KIND="dropbox"' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
jq -r 'to_entries[] | select(.key|startswith("DROPBOX_") or .=="DOCUMENT_SOURCE_KIND") | "\(.key) len=\(.value|length)"' "$F"
WINPATH="$(cygpath -m "$F" 2>/dev/null || echo "$F")"
aws secretsmanager put-secret-value --secret-id uat/<slug>/app --secret-string "file://$WINPATH" --query VersionStages && rm -f "$F"
```

`DROPBOX_PATH_ROOT_NAMESPACE_ID` is an empty string when the folder is not in a team space.
That is valid; the connector treats empty as "no header". Also update `MCP_OAUTH_SCOPES` to
include `documents:read` (ADR 0001 §8 explains why).

**EVIDENCE 03b.6** — paste the `len=` lines and the `VersionStages` output.
**Accept when:** all six keys are present; `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`,
`DROPBOX_REFRESH_TOKEN` and `DROPBOX_ROOT_FOLDER_ID` have non-zero length;
`DOCUMENT_SOURCE_KIND len=7`; `["AWSCURRENT"]`.

## Success criteria

- [ ] 03b.1–03b.5 accepted
- [ ] App secret stored in a password manager; refresh token only in `.env.local`
- [ ] 03b.6 accepted (deferred until the connector merges)

## Failure modes

| Symptom | Cause / fix |
|---|---|
| Dedicated account cannot accept or add the shared folder ("not enough space") | On non-team plans a shared folder counts against **every member's** quota, and a free Basic account has 2 GB. Upgrade the dedicated account, or (Business/Teams) have the admin add it as a team member. Check the folder size before step 3. |
| Dedicated account was created with the developer's email | Ownership must sit with the client, so they can revoke it after offboarding. Change the account email to a client-controlled address and hand over the password and 2-step backup codes. |
| `invalid_grant` at step 4 | The code expired, was used already, or was issued for a different app key. Run `authorize` again and paste the code promptly. |
| `invalid_client` at step 4 or 5 | Wrong app key or secret in `.env.local` (a stray quote, space or Windows `\r`). Re-copy from the app's Settings tab. |
| Token scopes missing `files.content.read` | Permissions were changed after the token was issued. Submit permissions, then repeat step 4. |
| `folder=not_found` (`path/not_found`) | The share was not accepted by the dedicated account, the path is wrong (paths are case-insensitive but must be exact otherwise), or the folder is in a team space and `team_space=yes` was ignored. Check the dedicated account's file browser first. |
| `folder=found` but `entries` all 0, and the client says it has files | Team-space folder listed without `Dropbox-API-Path-Root`. The verify script handles this automatically; the connector must too. Otherwise the share is to a *different* subfolder. |
| `expired_access_token` / `invalid_access_token` at runtime | Expected every ~4 hours. The connector refreshes. If refreshing itself returns `invalid_grant`, the token was revoked: see Play 14 section N. |
| Authorize page says the app is blocked or cannot be linked | The client's Dropbox Business admin restricts third-party apps. Their admin must allow the app (by app key). This is their action, not ours. |

## Rotation (Play 14 section N, to be added)

Revoke: as the dedicated account, **Settings → Connected apps → Disconnect**. That kills
the refresh token. Regenerate the app secret on the app's Settings tab if it was exposed.
Re-issue: repeat step 4, then repeat step 6's merge and redeploy `mcp` only, the same way
as Play 14 section M.
