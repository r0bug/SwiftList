# @swiftlist/mcp-server

A stdio Model Context Protocol server that lets a Claude Code or Claude
Desktop session drain swiftlist's pending external-AI batches. The host LLM
does the vision inference in-context (billed to the caller's Claude
subscription) and reports the structured result back to swiftlist, so
swiftlist never hits the Anthropic API for these batches.

## Workflow

1. swiftlist's ingest pipeline sees `ai_provider = external-mcp` in
   Settings and, instead of calling Anthropic, inserts a row into
   `ExternalAnalysisBatch` with `status = QUEUED`.
2. The MCP client (Claude Code) calls `list_pending_batches` to discover
   work.
3. It calls `get_batch { batchId }` which atomically marks the row
   `CLAIMED` and returns each photo as a base64 JPEG plus any
   continuation hint.
4. The host model inspects the images and produces an `AnalysisResult`
   matching swiftlist's schema (groups of photoIndices → item fields,
   with confidence).
5. It calls `commit_batch { batchId, result }`. The server replays the
   same transaction that the direct-Anthropic ingest path would have run
   (create Item or attach to continuation, PhotoGroup bookkeeping,
   IngestEvents, host images, recompute completeness) and flips the row
   to `COMMITTED`.

Cost accounting: `Item.aiCost` is recorded as `0` on this path because
the vision work happened on the caller's subscription, not via
swiftlist's `ANTHROPIC_API_KEY`.

## Add to Claude Code / Claude Desktop

In your MCP client config (e.g. `~/.config/claude-code/mcp.json` or
Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "swiftlist": {
      "command": "node",
      "args": ["/absolute/path/to/swiftlist/packages/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@host:5432/db",
        "PUBLIC_IMAGES_DIR": "/absolute/path/to/swiftlist/public-images",
        "PUBLIC_IMAGE_BASE_URL": "http://localhost:3003"
      }
    }
  }
}
```

Build first with:

```
npm run build --workspace @swiftlist/mcp-server
```

## Enable external-MCP on the swiftlist server

The server only emits rows to `ExternalAnalysisBatch` when its
`ai_provider` setting is `external-mcp`. Flip it in the admin UI at
`/settings/ai-provider` (or POST to the same endpoint). Until you do,
the MCP server will keep reporting an empty `list_pending_batches`.

## Tools

- `list_pending_batches({ limit? })` → `[{ id, sourceFolder, photoCount, continuation?, createdAt }]`
- `get_batch({ batchId })` → `{ id, sourceFolder, photos: [{ index, photoId, filename, imageBase64, mediaType, capturedAt? }], continuation? }` (also claims the batch)
- `commit_batch({ batchId, result })` → `{ ok: true, assignedItemIds }`
