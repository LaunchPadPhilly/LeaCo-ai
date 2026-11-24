# 0003 — Dropbox as the document source

- Status: Accepted; implemented in `src/lib/server/dropbox` and `src/lib/server/documents`
- Date: 2026-11-24
- Scope: how LeaCo's documents reach the MCP server, how they are stored and searched, and who can read them
- Related: ADR 0001 (Google Drive design, never implemented in this repository), Play 03b (credential), ADR 0002 (scopes)

## Context

LeaCo keeps its working documents in Dropbox, not Google Drive. Sign-in stays on Google
(Play 03); Dropbox is only a document source. The folder (`/LeaCo - Oncor`, shared to a
dedicated account) holds five subfolders: Daily Reports, Oncor, OneOk, RRR Grazing Lease
and XRI. On 2026-11-24 it held 63 files of four types: PDF, Outlook MSG, Word DOCX and
Google Earth KMZ. The largest file was 156 MB.

Before this change the repository had no document code at all, despite CLAUDE.md
describing `documents:ingest` and document tools. ADR 0001's Drive connector was designed
but never built here.

The Daily Reports are the source of the data the Amplified API does not return (injection
volumes, pumper notes, the problem list). The other four folders are contracts and
correspondence with counterparties.

## Decision

### 1. Credential: a dedicated Dropbox account and a read-only scoped app

Dropbox has no service account. A dedicated account (handed over to LeaCo) is shared into
the folder, and our app holds a refresh token for it. The app is Full Dropbox but has
only `files.metadata.read`, `files.content.read` and `account_info.read`, so nothing in this
code path can change Dropbox. Setup and evidence are in Play 03b. The root is configured by
folder id (`DROPBOX_ROOT_FOLDER_ID`), which survives renames and moves.

### 2. Storage: Postgres, one row per file, text per page

`Document` (one row per file, plus one row per readable email attachment with `parentId`),
`DocumentPage` (text per PDF page, or per ~20,000-character section for other kinds),
`DocumentPlace` (KMZ placemarks with coordinates) and `DocumentIngestRun` (one row per
sync). Files that disappear from Dropbox are marked `REMOVED`, never deleted, so earlier
answers can still be traced.

### 3. Sync: incremental, by content hash, one run at a time

`pnpm run documents:ingest` lists the folder recursively and compares Dropbox's
`content_hash` per file id: new files are added, changed files re-read, renamed or moved
files only get a new path, and missing files are marked removed. `--force` re-reads
everything; `--dry-run` writes nothing. A partial unique index on the `RUNNING` row makes a
second concurrent run fail fast with `ALREADY_RUNNING`. A run left `RUNNING` for over three
hours is closed as stale.

Every file is read regardless of size; large files are streamed to a temporary file during
download, and the run reports the largest file size. A file that cannot be read within five
minutes, or that throws, is stored as `FAILED` with a short reason and the run continues.
`FAILED` files are retried only when they change or with `--force`, so one bad file cannot
make every run slow.

### 4. Reading files

| Type | Library | Result |
|---|---|---|
| PDF | `unpdf` (pdf.js) | Text per page. A PDF with no text layer is `NO_TEXT` ("needs OCR"); there is no OCR in this version. |
| DOCX | `mammoth` | Plain text. |
| MSG | `@kenjiuno/msgreader` | Subject, sender, recipients and sent date (stored in `meta`), body text; PDF, DOCX, KMZ and MSG attachments become their own documents. Embedded emails are listed but not read. |
| KMZ / KML | `fflate` + `fast-xml-parser` | Each placemark's name, description, KML folder and coordinates, also written as searchable text. |

### 5. Search: Postgres full-text, not embeddings

`DocumentPage.searchVector` is a generated `tsvector` column with a GIN index, queried with
`websearch_to_tsquery` (quoted phrases, OR, exclusions). It needs no extra vendor and
handles well names, lease names and dates well. Semantic search can be added later
without changing the storage.

### 6. Access: a separate `documents:read` scope

The counterparty folders are more sensitive than operational data, so the six tools
(`documents_search`, `document_get`, `document_folders_browse`, `document_source_status`,
`document_source_changes`, `document_places`) require a new `DOCUMENTS_READ` scope that an
admin grants per user. It is not the default scope. All tools read the database only,
except `document_source_changes`, which also lists Dropbox with the read-only app.

The MCP server now sends instructions at connect time requiring a citation (file, folder,
page) and a verbatim quote under every claim taken from a document.

## Consequences

- **Deployment order (Play 03b step 6):** put the Dropbox keys into `uat/leaco/app` first,
  then add them to `mcp_secret_keys`, then apply Terraform and deploy. If
  `MCP_OAUTH_SCOPES` is set in the secret, add `documents:read` to it, or OAuth clients
  cannot request the new scope. Until then the tools return `NOT_CONFIGURED` or no results.
- **Running the sync deployed:** as a one-off ECS task on the MCP image (command override
  `node_modules/.bin/tsx scripts/ingest-documents.ts`), since only in-VPC tasks reach RDS.
  An hourly EventBridge schedule is a follow-up.
- **Memory:** pdf.js holds the whole PDF in memory while reading it. The 156 MB file needs
  the MCP task to have enough memory headroom for the one-off sync task.
- **Not covered:** OCR for scanned PDFs, structured numbers from the Daily Reports
  (injection per well), embedded emails inside emails, and file types other than the four
  above (listed as `UNSUPPORTED`).
