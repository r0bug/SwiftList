# swiftlist

Local-first eBay listing assistant. Watches a folder (or a phone/camera that gets plugged in), uses Anthropic Claude vision to recognize and group multi-angle photos into Items, then drives eBay's own listing UI through a Chrome extension to do sold-comp research, populate eBay drafts, and **resume drafts where you left off**.

swiftlist deliberately does **not** call the eBay Trading API — that's listflow's job. swiftlist treats eBay's draft/listing UI as the source of truth and acts as a smart autofill + draft-resume layer on top.

Sister projects:
- **listflow** — full eBay listing workflow with direct Trading API push.
- **comptool** — eBay sold-comps research database with Chrome extension scraper.

All three speak the [`UniversalItem`](../comptool/UNIVERSAL-ITEM-SCHEMA.md) schema.

## Architecture

```
┌─ camera / phone ─┐    ┌─ swiftlist-watcher ─┐    ┌─ swiftlist server ─┐
│  USB plug event  │───▶│  chokidar + USB     │───▶│  ingest pipeline    │
│  /home/.../Photos│    │  importer (DCIM/)   │    │  sha256 → exif →    │
└──────────────────┘    └─────────────────────┘    │  phash → cluster →  │
                                                   │  Claude Sonnet 4.6  │
                                                   │  → Item + Photos    │
                                                   └────────┬────────────┘
                                                            ▼
              ┌─ React web UI ─┐               ┌─ Postgres (swiftlist schema) ─┐
              │  edit, regroup,│◀─────────────▶│  Item, Photo, PhotoGroup,     │
              │  set primary,  │               │  EbayDraft, SoldCompLink,…    │
              │  view drafts   │               └────────────┬──────────────────┘
              └────────────────┘                            ▼
                                              ┌─ Chrome MV3 extension ─┐
                                              │  content-sold:    find │
                                              │  content-detail:  pull │
                                              │  content-listing: fill │
                                              │  content-draft:   resume
                                              │  content-drafts:  badge│
                                              └────────────┬───────────┘
                                                           ▼
                                                       ebay.com
```

## Status

**Phase 1 — Core UI + auth + external-AI option.**

- **Server** — `/auth/{login,logout,me}`, `/items` (+ `/:id/merge-into`, `/:id/photos/move`), `/pool`, `/drafts`, `/devices`, `/ingest/{scan,status,photo}`, `/settings/{api-keys,password,ai-provider,ingest-hint}`, `/extension/*`.
- **Web UI** — DB-backed login (JWT cookie), Items list + Detail (photo multi-select, merge-into-another-item, move-selected-photos), Pool (un-grouped photos), Drafts, Devices, Settings (API keys + change password + ingest hint + vision-provider).
- **Chrome extension** — popup is the config + nav surface: connection status, "Open web UI", 5 nav buttons into the web UI, inline config panel (baseUrl / apiKey / webUrl / vision-provider), **Scan inbox** button with a live progress bar that tracks image-recognition in real time, and a "N awaiting external AI" badge when the external-MCP path is in use.
- **MCP server** (`@swiftlist/mcp-server`) — stdio MCP server exposing `list_pending_batches`, `get_batch`, `commit_batch`. Lets a Claude Code / Desktop session (running on the user's Claude Max subscription) do the vision inference in-context instead of swiftlist hitting the Anthropic API.

See [INSTALL.md](INSTALL.md) for setup.

### Vision providers

Pick under Settings → Vision provider (web) or Config → Vision provider (extension popup):

- `anthropic` (default) — swiftlist calls `anthropic.messages.create` directly, billed per-token against `ANTHROPIC_API_KEY`.
- `external-mcp` — ingest queues an `ExternalAnalysisBatch` instead of calling Anthropic. A Claude Code session (via the MCP server) lists / claims / commits batches. Inference is billed against the user's Max sub, not the API key.
- `mock` — no AI; useful for dev.

### Use Claude Max via Claude Code

1. Build once: `npm run build --workspace @swiftlist/mcp-server`.
2. Add to your Claude Code config (`~/.config/claude-code/config.json`):

   ```json
   {
     "mcpServers": {
       "swiftlist": {
         "command": "node",
         "args": ["/absolute/path/to/swiftlist/packages/mcp-server/dist/index.js"],
         "env": { "DATABASE_URL": "postgresql://swiftlist:swiftlist@localhost:5432/swiftlist?schema=swiftlist" }
       }
     }
   }
   ```

3. Flip Vision provider to `external-mcp`. Ingest as usual (drop photos / hit Scan inbox); batches go QUEUED.
4. In Claude Code: "list pending swiftlist batches, then for each, get_batch, analyze the images, and commit_batch with the result." The popup's badge counts down as batches commit.

## Quick start

```bash
./install.sh
```

The installer is loop-until-done idempotent: safe to Ctrl+C and re-run. It:
1. Checks Node 18.18+ and Postgres tooling.
2. Generates `.env` from `.env.example` (JWT secret, defaults derived from `$PWD`).
3. Brings up / provisions Postgres as needed.
4. `npm install`, Prisma migrate + generate + seed (default user `john@robug.com` / `ListFast`).
5. Mints an extension API key and writes it into `packages/extension/defaults.js` so the Chrome extension is pre-configured on load-unpacked.

Then in three terminals:

```bash
npm run dev:server    # API on :3004
npm run dev:client    # web UI on :5173
npm run dev:watcher   # folder watcher daemon
```

Web UI: <http://localhost:5173> — log in with `john@robug.com` / `ListFast` and change the password under Settings.

## First migration — important

swiftlist shares a Postgres database with comptool. The `swiftlist` schema does not exist yet. Before the first `prisma migrate dev`, ensure your `DATABASE_URL` user has `CREATE` on the database, and Prisma will issue `CREATE SCHEMA IF NOT EXISTS swiftlist` automatically (the `schemas = ["swiftlist"]` datasource setting handles this).

```bash
npm run prisma:migrate -- --name init
```

## Cloud DB + local images

`DATABASE_URL` points anywhere. `PUBLIC_IMAGE_BASE_URL` defaults to `http://localhost:3003`, so image URLs in the DB resolve to your local machine even when the database is in the cloud. Three escape hatches if the extension runs on a different machine than the server:

1. Tunnel the local server: `tailscale serve`, `cloudflared tunnel`. Set `PUBLIC_IMAGE_BASE_URL` to the tunnel URL.
2. Set `IMAGE_MIRROR=s3` + S3 credentials. The watcher uploads each optimized image to S3/R2 and writes `Photo.cdnUrl`. Autofill prefers `cdnUrl` over `publicUrl`. **`Photo.cdnUrl` is in the schema from day one — flipping the env var is a config change, not a migration.**
3. Run the extension on the same machine as the server (default).

## Notes

- We use **npm workspaces** (ships with Node 20). The plan originally specified pnpm — swap is trivial if you prefer pnpm later (`pnpm import` reads the existing lockfile).
- The Chrome extension is plain vanilla JS with no bundler — same approach as comptool, so the mental model is identical across both extensions.
- When the AI splits one physical object into multiple items (common failure mode), open the Item, multi-select the photos that belong on a different item, and **Move selected to…** — or use **Merge into…** to collapse the whole item into the correct one. Both actions re-compute completeness for the affected items.
- The ingest hint (Settings → Ingest hint) is prepended to every vision prompt as "CATALOG CONTEXT from seller" and nudges Claude's grouping/titling — useful for steering toward inventory-specific language (e.g. "antique hardware; treat an assembled fixture as one item").
