# swiftlist — session handoff

Auto-loaded by Claude Code. Written 2026-04-23 right after registering the
swiftlist MCP server in user scope. Keep this file short; delete or fold
into another doc once the in-flight work below is done.

## First thing to do in this session

There is **1 `ExternalAnalysisBatch` row in QUEUED state** at
`/home/robug/swiftlist/inbox`. Vision provider was flipped to `external-mcp`
during testing and some ingests queued up waiting for a Claude Max / Claude
Code worker (this session). The user wants it drained.

**Workflow:**

1. Confirm the MCP server is attached: `swiftlist` should appear in the tool
   list with tools `list_pending_batches`, `get_batch`, `commit_batch`.
2. `swiftlist.list_pending_batches({})` → expect at least one batch.
3. For each batch:
   - `swiftlist.get_batch({ batchId })` — returns `photos[]` with base64
     JPEGs and a `continuation` hint (may be null).
   - Look at each image. Produce an `AnalysisResult` that matches the
     `AnalysisResultSchema` in
     `/home/robug/swiftlist/packages/server/src/services/ai.service.ts`
     (zod schema; groups[].photoIndices, item: {title,description,brand,model,
     category,condition,features,keywords,itemSpecifics,upc,isbn,mpn},
     confidence, isContinuationOfExistingItem, existingItemMatchConfidence).
   - `swiftlist.commit_batch({ batchId, result })`. Server replays the
     normal ingest transaction (Item create / continuation attach / photo
     assignment / IngestEvents + hostItemImages + completeness).
4. The extension popup's "N awaiting external AI" badge should tick to 0.

**Grouping guidance (mirror the ingest prompt):** if consecutive filenames
and tight timestamps suggest a single burst, keep them as ONE group unless
the visual evidence is unambiguous. Read visible text aggressively — brand,
model, MPN, UPC, serial/patent numbers go into their own fields; don't
guess values not visible on the item itself.

If the ingest hint is set (Setting row `ingest_hint` — check via
`/api/v1/settings/ingest-hint`), include it as catalog context.

## Running dev processes (at handoff time)

- **Server**: `tsx watch packages/server/src/server.ts` on :3004
- **Client**: `vite` on :5173
- **Watcher**: `tsx watch packages/watcher/src/index.ts`, watches
  `/home/robug/swiftlist/inbox`, posts to `:3004`
- Login: `john@robug.com` / `ListFast` (seeded)
- Extension API key: in `packages/extension/defaults.js` (git-ignored)

## Recent landings (pushed to github.com/r0bug/SwiftList)

- `f366234` per-photo eBay image search (Browse API) + OCR priority in
  ingest prompt
- `42dd414` static-mount path fix (resolveConfigPath anchors to workspace
  root) + `/api/v1/items/photo/:id/thumb`
- `ca716ae` watcher env walkup + lazy api.ts capture
- `ca84008` pre-commit hook auto-bumps extension manifest patch
- `df1bf8a` external-MCP vision provider + `@swiftlist/mcp-server` workspace

## Gotchas

- Don't revert the pre-commit hook at `hooks/pre-commit`; `git config
  core.hooksPath hooks` is set locally. Extension source edits auto-bump
  manifest patch. Bypass with `SWIFTLIST_SKIP_BUMP=1 git commit`.
- Paths from env (`UPLOADS_DIR`, `PUBLIC_IMAGES_DIR`) are relative strings
  — always resolve via `resolveConfigPath()` in
  `packages/server/src/util/paths.ts`, never `path.resolve(env.X, ...)`
  directly. `path.resolve` anchors to cwd and the server runs from
  `packages/server/`, which breaks the static mount.
- `Photo.thumbnailPath` / `optimizedPath` store ABSOLUTE filesystem paths,
  not URL-relative paths. Never concatenate them onto `/uploads/`. Use the
  `/api/v1/items/photo/:id/thumb` endpoint instead.
- After draining the external queue, ask the user whether to flip vision
  provider back to `anthropic` for automatic ingest. Right now it stays
  on `external-mcp`, so every future ingest will queue again.
