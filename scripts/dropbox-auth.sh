#!/usr/bin/env bash
# Dropbox document-source bootstrap (playbook/03b-dropbox-app.md).
#
#   ./scripts/dropbox-auth.sh authorize   one-time consent -> DROPBOX_REFRESH_TOKEN in .env.local
#   ./scripts/dropbox-auth.sh verify      refresh, identify account, resolve and count the folder
#
# Secrets are read silently, passed to curl on stdin (never argv, so they are not
# visible in the process list), and never printed. Run from the repository root.
set -euo pipefail

ENV_FILE=".env.local"
API="https://api.dropboxapi.com"

die() { echo "ERROR: $*" >&2; exit 1; }
command -v curl >/dev/null || die "curl not found"
command -v jq   >/dev/null || die "jq not found"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found; run from the repository root (Play 04)"

# Read KEY from .env.local, stripping CR and one pair of surrounding quotes.
env_get() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' \
    | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true
}

# Set KEY=VALUE in .env.local (replace or append), mode 600, value never echoed.
env_set() {
  local key="$1" value="$2" tmp
  umask 077
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

need() {
  local key="$1" secret="${2:-no}" v
  v="$(env_get "$key")"
  if [ -z "$v" ]; then
    if [ "$secret" = yes ]; then read -rsp "$key (hidden): " v; echo >&2
    else read -rp "$key: " v; fi
    [ -n "$v" ] || die "$key is required"
    env_set "$key" "$v"
  fi
  printf '%s' "$v"
}

# POST to the token endpoint with HTTP basic auth supplied via curl config on stdin.
token_post() { # $1 app key, $2 app secret, rest: --data-urlencode args
  local k="$1" s="$2"; shift 2
  printf 'user = "%s:%s"\n' "$k" "$s" \
    | curl -sS -K - -X POST "$API/oauth2/token" "$@"
}

# POST JSON to an RPC endpoint with the bearer token supplied via stdin.
rpc() { # $1 token, $2 endpoint, $3 json body, $4 optional path-root namespace id
  local hdr=""
  [ -n "${4:-}" ] && hdr="header = \"Dropbox-API-Path-Root: {\\\".tag\\\": \\\"root\\\", \\\"root\\\": \\\"$4\\\"}\""
  printf 'header = "Authorization: Bearer %s"\n%s\n' "$1" "$hdr" \
    | curl -sS -K - -X POST "$API$2" -H 'Content-Type: application/json' --data "$3"
}

cmd_authorize() {
  local key secret code resp
  key="$(need DROPBOX_APP_KEY)"
  secret="$(need DROPBOX_APP_SECRET yes)"
  echo "Open this URL in a private window signed in as the DEDICATED Dropbox account:"
  echo
  echo "  https://www.dropbox.com/oauth2/authorize?client_id=${key}&response_type=code&token_access_type=offline"
  echo
  read -rsp "Paste the code Dropbox shows (hidden): " code; echo
  [ -n "$code" ] || die "no code entered"
  resp="$(token_post "$key" "$secret" \
    --data-urlencode "code=$code" --data-urlencode "grant_type=authorization_code")"
  if ! jq -e '.refresh_token' >/dev/null 2>&1 <<<"$resp"; then
    echo "exchange_failed error=$(jq -r '.error // "unknown"' <<<"$resp" 2>/dev/null)" >&2
    exit 1
  fi
  env_set DROPBOX_REFRESH_TOKEN "$(jq -r '.refresh_token' <<<"$resp")"
  echo "REFRESH_TOKEN_SAVED"
  echo "scope=$(jq -r '.scope // ""' <<<"$resp")"
}

cmd_verify() {
  local key secret refresh root resp at acct tag home rootns ns meta id list
  key="$(env_get DROPBOX_APP_KEY)";        [ -n "$key" ]     || die "DROPBOX_APP_KEY missing"
  secret="$(env_get DROPBOX_APP_SECRET)";  [ -n "$secret" ]  || die "DROPBOX_APP_SECRET missing"
  refresh="$(env_get DROPBOX_REFRESH_TOKEN)"; [ -n "$refresh" ] || die "DROPBOX_REFRESH_TOKEN missing; run authorize"
  root="$(env_get DROPBOX_ROOT_PATH)";     [ -n "$root" ]    || die "DROPBOX_ROOT_PATH missing (e.g. /LeaCo Programs)"

  resp="$(token_post "$key" "$secret" \
    --data-urlencode "grant_type=refresh_token" --data-urlencode "refresh_token=$refresh")"
  at="$(jq -r '.access_token // empty' <<<"$resp")"
  [ -n "$at" ] || { echo "token_refresh=failed error=$(jq -r '.error // "unknown"' <<<"$resp")"; exit 1; }
  echo "token_refresh=ok"

  acct="$(rpc "$at" /2/users/get_current_account 'null')"
  echo "account_type=$(jq -r '.account_type[".tag"] // "unknown"' <<<"$acct")"
  tag="$(jq -r '.root_info[".tag"] // ""' <<<"$acct")"
  home="$(jq -r '.root_info.home_namespace_id // ""' <<<"$acct")"
  rootns="$(jq -r '.root_info.root_namespace_id // ""' <<<"$acct")"
  ns=""
  if [ "$tag" = team ] && [ -n "$rootns" ] && [ "$rootns" != "$home" ]; then
    ns="$rootns"
    echo "team_space=yes"
    echo "  add to .env.local: DROPBOX_PATH_ROOT_NAMESPACE_ID=$ns"
  else
    echo "team_space=no"
  fi

  meta="$(rpc "$at" /2/files/get_metadata "$(jq -nc --arg p "$root" '{path:$p}')" "$ns")"
  if [ "$(jq -r '.[".tag"] // ""' <<<"$meta")" != folder ]; then
    echo "folder=not_found error=$(jq -r '.error_summary // .[".tag"] // "unknown"' <<<"$meta")"
    exit 1
  fi
  id="$(jq -r '.id' <<<"$meta")"
  echo "folder=found"
  echo "folder_id=$id"

  list="$(rpc "$at" /2/files/list_folder "$(jq -nc --arg p "$id" '{path:$p, recursive:false, limit:2000}')" "$ns")"
  jq -r '"entries files=\([.entries[]|select(.[".tag"]=="file")]|length) folders=\([.entries[]|select(.[".tag"]=="folder")]|length) more=\(.has_more)"' <<<"$list" \
    || echo "list_failed error=$(jq -r '.error_summary // "unknown"' <<<"$list")"
}

case "${1:-}" in
  authorize) cmd_authorize ;;
  verify)    cmd_verify ;;
  *) echo "usage: $0 {authorize|verify}" >&2; exit 2 ;;
esac
