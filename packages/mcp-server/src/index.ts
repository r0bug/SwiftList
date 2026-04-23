#!/usr/bin/env node
// swiftlist-mcp — stdio MCP server that lets a Claude Code / Desktop session
// drain swiftlist's QUEUED external-analysis batches. The host LLM does the
// vision inference in-context and calls commit_batch with the structured
// result; swiftlist never hits the Anthropic API for these batches.
//
// Transport: stdio. Name: "swiftlist". Tools: list_pending_batches, get_batch,
// commit_batch. State lives in Postgres (ExternalAnalysisBatch); the MCP
// server is stateless.

import fs from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PrismaClient } from '../../server/src/generated/prisma/index.js';
import {
  CommitBatchInput,
  GetBatchInput,
  ListPendingBatchesInput,
  commitBatchTool,
  getBatch,
  listPendingBatches,
} from './tools.js';

// ──────────────────────────────────────────────────────────────────────
// Env bootstrap — walk up from cwd looking for .env (same pattern as
// packages/server/src/config/env.ts). Keeps the MCP server usable from
// any subdirectory without requiring an explicit env file.
// ──────────────────────────────────────────────────────────────────────

function loadDotEnvWalkup(): void {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cur, '.env');
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        for (const line of content.split('\n')) {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
          if (!m) continue;
          const key = m[1]!;
          let val = m[2] ?? '';
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) process.env[key] = val;
        }
      } catch {
        // fall through — env vars might already be set by shell
      }
      return;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}
loadDotEnvWalkup();

if (!process.env.DATABASE_URL) {
  process.stderr.write(
    '[swiftlist-mcp] FATAL: DATABASE_URL not set. Put it in the MCP client config\'s env block, or in a .env at the repo root.\n',
  );
  process.exit(1);
}

const PUBLIC_IMAGES_DIR = process.env.PUBLIC_IMAGES_DIR ?? 'public-images';
const PUBLIC_IMAGE_BASE_URL = process.env.PUBLIC_IMAGE_BASE_URL ?? 'http://localhost:3003';

const prisma = new PrismaClient({
  log: ['error'],
});

// ──────────────────────────────────────────────────────────────────────
// Tool descriptors (JSON Schema). Kept in sync with the Zod schemas in
// tools.ts — we hand-write the JSON Schema because most MCP clients
// expect plain JSON Schema Draft 7 rather than Zod.
// ──────────────────────────────────────────────────────────────────────

const TOOL_LIST_PENDING = {
  name: 'list_pending_batches',
  description:
    'List external-AI batches that swiftlist has queued for an MCP worker. ' +
    'Returns batches with status=QUEUED in FIFO order. Call get_batch to claim one.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'number',
        description: 'Max batches to return (default 20, max 100).',
      },
    },
    additionalProperties: false,
  },
};

const TOOL_GET_BATCH = {
  name: 'get_batch',
  description:
    'Fetch a batch\'s photos as base64-encoded JPEGs and atomically claim it ' +
    '(QUEUED → CLAIMED). After looking at the photos, call commit_batch with ' +
    'the structured AnalysisResult. Photos are indexed 1..N in the order ' +
    'returned — use those indices in commit_batch\'s result.groups[].photoIndices.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      batchId: { type: 'string' },
    },
    required: ['batchId'],
    additionalProperties: false,
  },
};

const TOOL_COMMIT_BATCH = {
  name: 'commit_batch',
  description:
    'Commit a batch by supplying the AnalysisResult (groups → Items). Replays ' +
    'swiftlist\'s ingest transaction: creates Items, assigns photos to ' +
    'PhotoGroup, writes IngestEvents, hosts images, recomputes completeness. ' +
    'Idempotent failure — call with the SAME batchId + result after a transient ' +
    'error and the row will be marked COMMITTED. aiCost is recorded as 0 because ' +
    'this path used the caller\'s Claude subscription, not swiftlist\'s API key.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      batchId: { type: 'string' },
      result: {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                photoIndices: { type: 'array', items: { type: 'integer' } },
                isContinuationOfExistingItem: { type: 'boolean' },
                existingItemMatchConfidence: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                item: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', maxLength: 120 },
                    description: { type: 'string' },
                    brand: { type: ['string', 'null'] },
                    model: { type: ['string', 'null'] },
                    category: { type: 'string' },
                    ebayCategoryId: { type: 'string' },
                    condition: { type: 'string' },
                    conditionId: { type: 'integer' },
                    features: { type: 'array', items: { type: 'string' } },
                    keywords: { type: 'array', items: { type: 'string' } },
                    itemSpecifics: { type: 'object', additionalProperties: { type: 'string' } },
                    upc: { type: ['string', 'null'] },
                    isbn: { type: ['string', 'null'] },
                    mpn: { type: ['string', 'null'] },
                    estimatedValueUsd: { type: 'number' },
                  },
                  required: ['title'],
                },
              },
              required: ['photoIndices', 'item'],
            },
          },
        },
        required: ['groups'],
      },
    },
    required: ['batchId', 'result'],
    additionalProperties: false,
  },
};

// ──────────────────────────────────────────────────────────────────────
// Server + transport
// ──────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'swiftlist', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [TOOL_LIST_PENDING, TOOL_GET_BATCH, TOOL_COMMIT_BATCH],
}));

interface CallToolRequest {
  params: { name: string; arguments?: Record<string, unknown> };
}

server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
  const { name, arguments: rawArgs } = req.params;
  const args: Record<string, unknown> = rawArgs ?? {};

  try {
    if (name === 'list_pending_batches') {
      const parsed = ListPendingBatchesInput.parse(args);
      const out = await listPendingBatches(prisma, parsed);
      return jsonResult(out);
    }
    if (name === 'get_batch') {
      const parsed = GetBatchInput.parse(args);
      const out = await getBatch(prisma, parsed);
      return jsonResult(out);
    }
    if (name === 'commit_batch') {
      const parsed = CommitBatchInput.parse(args);
      const out = await commitBatchTool(prisma, parsed, {
        publicImagesDir: PUBLIC_IMAGES_DIR,
        publicImageBaseUrl: PUBLIC_IMAGE_BASE_URL,
      });
      return jsonResult(out);
    }
    return errorResult(`unknown tool: ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Mark the batch as ERROR if we failed mid-commit, so the operator can see it.
    if (name === 'commit_batch' && typeof (args as { batchId?: unknown }).batchId === 'string') {
      try {
        await prisma.externalAnalysisBatch.update({
          where: { id: (args as { batchId: string }).batchId },
          data: { status: 'ERROR', error: msg.slice(0, 2000) },
        });
      } catch {
        // swallow — original error is what matters
      }
    }
    return errorResult(msg);
  }
});

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[swiftlist-mcp] listening on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[swiftlist-mcp] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});
