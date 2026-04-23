# swiftlist — session handoff

Auto-loaded by Claude Code. Keep this file short; delete or fold into another
doc once the in-flight work below is done.

## Where we are (2026-04-23)

**Manual-grouping flow is now end-to-end wired.** The watcher creates
`Photo` rows only. Everything downstream is user-driven.

- **/pool** — unassigned thumbnails, multi-select + "Group Selected" button.
- **/groups/:id** — folder detail with working identification actions:
  - **Run AI identification** modal with optional per-run context textarea
    + "use eBay image-search priors" checkbox. Anthropic provider creates
    the Item inline (status `IN_PROCESS`); `external-mcp` queues an
    `ExternalAnalysisBatch` with `continuation={groupId,context}` for a
    Claude Code worker to drain.
  - **eBay image search** modal — pick which photo to search from, scroll
    results, "Use as identification" opens the approval panel (images-off
    default, "stock photo OK" hint if condition=New), commits to
    `/groups/:id/identify-ebay` and navigates to the new Item.
  - Per-photo hover actions: 🔍 (image-search from this photo), ↩︎
    (remove to pool), 🗑 (hard delete).
- **/ (Items)** — filter tabs: Unidentified / In-process / Drafts / Listed /
  Sold. "Unidentified" pulls `PhotoGroup where itemId IS NULL`; the rest pull
  `Item` rows filtered by `status`.

Key code touched:

- `prisma/schema.prisma` — `ItemStatus` enum gained `IN_PROCESS`;
  `PhotoGroup.label` added. Migration
  `20260423172301_manual_grouping_scaffolding` is applied.
- `packages/server/src/services/ingest.service.ts` — `flushBatch` stops
  after Photo persistence. `processCluster` + `recomputeCompleteness` were
  deleted (to be reborn as manual-trigger endpoints — see next steps).
- `packages/server/src/routes/groups.routes.ts`, `photos.routes.ts` — new.
  Mounted at `/api/v1/groups` and `/api/v1/photos`.
- `packages/client/src/routes/GroupDetailPage.tsx` — new. Route
  `/groups/:id` in `main.tsx`.
- `packages/client/src/routes/{ItemsPage,PoolPage}.tsx` — rewritten for
  filter tabs / multi-select.

## What's next (everything in the prior sequence is DONE)

Follow-on polish worth tracking:

1. **Re-run AI identification with approval panel.** Currently the
   `identify-ai` endpoint overwrites `Item` fields if run a second time
   against the same group (since the group's `itemId` is set after the
   first run, the transaction would fail with unique constraints). The
   approval panel should gate which AI-suggested fields overwrite existing
   ones. Today, re-run isn't reachable from the UI because the button only
   shows on unidentified groups.
2. **MCP server: restart-required after code changes.** Because Claude
   Code spawns the MCP process at session start and Node caches imports,
   code updates to `packages/mcp-server/dist/` don't take effect until the
   Claude Code session is restarted. Not a code problem, just a reminder
   when iterating on `commit.ts`.
3. **eBay image-search priors cost signal.** The priors bolt runs a
   Browse API call per identify-ai request. For bulk ingest sessions this
   could push you over Browse API daily quotas. If that starts to bite,
   either add a user-facing toggle (already wired as `useVisualPriors`)
   default OFF, or cache priors by `Photo.sha256`.
4. **Item detail editing for IN_PROCESS items.** There's no visible way
   in the UI to promote `IN_PROCESS → DRAFT` or to edit the auto-generated
   title. ItemDetailPage already has a PATCH path; a status-promotion
   button on the detail page would close this loop.

## Running dev processes

- **Server**: `tsx watch packages/server/src/server.ts` on :3004
- **Client**: `vite` on :5173
- **Watcher**: `tsx watch packages/watcher/src/index.ts`, watches
  `/home/robug/swiftlist/inbox`, posts to `:3004`
- Login: `john@robug.com` / `ListFast` (seeded)
- Extension API key: in `packages/extension/defaults.js` (git-ignored)

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
- `packages/server/src/services/ingest.service.ts` still imports
  `Prisma` from the generated client solely for `InputJsonValue` typing —
  do not delete that import when cleaning up.
- When re-implementing AI ident as a manual trigger, refactor against the
  pre-existing PhotoGroup rather than freshly clustering: the group is the
  container the user already confirmed. The old `processCluster` did both
  jobs; don't resurrect it — split clustering from analysis.
