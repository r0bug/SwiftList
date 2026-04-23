# swiftlist — session handoff

Auto-loaded by Claude Code. Keep this file short; delete or fold into another
doc once the in-flight work below is done.

## Where we are (2026-04-23)

**Manual-grouping scaffolding just landed.** The watcher no longer triggers
AI identification automatically. New photos create `Photo` rows only (no
`PhotoGroup`, no `Item`, no `ExternalAnalysisBatch` queue). Identification is
user-driven from the web UI:

- **/pool** — unassigned thumbnails, multi-select + "Group Selected" button.
- **/groups/:id** — folder detail. Shows the grouped photos, per-photo
  Remove-from-group and hard-Delete buttons, "+ Add photos from pool", and
  **placeholder** buttons for "Run AI identification" and "eBay image search"
  (disabled in this PR).
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

## What's next (sequence the user approved)

1. **Run AI identification** endpoint + UI wiring on the folder detail page.
   Accepts a PhotoGroup id + optional `context` text; LLM-analyzes the
   photos; creates an `Item` with `status = IN_PROCESS` and attaches the
   group. Re-runs replace the prior analysis but are gated by the approval
   panel (#3 below). For `external-mcp` provider, still queues an
   `ExternalAnalysisBatch` — the drain path (`packages/mcp-server`) is
   untouched and still works.
2. **eBay image search as identification** in folder detail. User clicks
   image search on one photo, picks a result, whole group promotes to
   `IN_PROCESS` under the selected eBay item's name. Backend is a
   generalized variant of the existing `/items/:id/sold-comp-link` path.
3. **Per-field import approval panel** — new `PendingCompLink` staging
   shape (or `SoldCompLink.approvedFields Json`), with a checkbox-per-field
   UI. Checkboxes default ON for title/category/specifics/description/
   condition and OFF for images. If the Item's condition is New, surface a
   hint next to the images checkbox but still require opt-in. This gates
   both the AI re-run path and the eBay attach path.
4. **Extension: Associate button on active eBay listing and /sch/ pages**
   (sibling of `packages/extension/content-sold.js`) so sold-but-qty-remaining
   items can be attached without hunting for the sold-only view.
5. **eBay image search as ingest prior** — before any LLM call, search the
   primary photo on eBay Browse, inject top 3–5 hits' title/category/
   itemSpecifics into the prompt as hints. Browse API is rate-limited, so
   start with primary-photo-only.

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
