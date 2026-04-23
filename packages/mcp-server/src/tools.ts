// Three MCP tool implementations:
//   - list_pending_batches
//   - get_batch (claims atomically on fetch)
//   - commit_batch (validates + replays the ingest transaction)
//
// Pure functions — no MCP SDK types bleed in here; index.ts handles the
// transport wiring. This keeps the tool logic trivially unit-testable.

import fs from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import type { PrismaClient } from '../../server/src/generated/prisma/index.js';
import { AnalysisResultSchema, commitBatch } from './commit.js';

// Mirror ai.service.ts MAX_LONG_EDGE to keep image sizes consistent between
// direct-Anthropic and external-MCP paths.
const MAX_LONG_EDGE = 1500;
const JPEG_QUALITY = 85;

// ──────────────────────────────────────────────────────────────────────
// list_pending_batches
// ──────────────────────────────────────────────────────────────────────

export const ListPendingBatchesInput = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export interface ListPendingBatchesOutput {
  batches: Array<{
    id: string;
    sourceFolder: string;
    photoCount: number;
    continuation?: {
      itemId: string;
      itemTitle: string;
      representativePhotoPaths: string[];
    };
    createdAt: string;
  }>;
}

export async function listPendingBatches(
  prisma: PrismaClient,
  input: z.infer<typeof ListPendingBatchesInput>,
): Promise<ListPendingBatchesOutput> {
  const rows = await prisma.externalAnalysisBatch.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: input.limit ?? 20,
  });

  return {
    batches: rows.map((r) => ({
      id: r.id,
      sourceFolder: r.sourceFolder,
      photoCount: r.photoIds.length,
      continuation: parseContinuation(r.continuation),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// get_batch  (atomically claims)
// ──────────────────────────────────────────────────────────────────────

export const GetBatchInput = z.object({
  batchId: z.string().min(1),
});

export interface GetBatchOutput {
  id: string;
  sourceFolder: string;
  photos: Array<{
    index: number;
    photoId: string;
    filename: string;
    imageBase64: string;
    mediaType: string;
    capturedAt: string | null;
  }>;
  continuation?: {
    itemId: string;
    itemTitle: string;
    representativePhotoPaths: string[];
  };
}

export async function getBatch(
  prisma: PrismaClient,
  input: z.infer<typeof GetBatchInput>,
): Promise<GetBatchOutput> {
  const { batchId } = input;

  // Atomic claim: only transition QUEUED → CLAIMED. Idempotent for CLAIMED.
  const batch = await prisma.externalAnalysisBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`batch ${batchId} not found`);

  if (batch.status === 'COMMITTED') {
    throw new Error(`batch ${batchId} already committed`);
  }
  if (batch.status === 'ERROR') {
    throw new Error(`batch ${batchId} is in ERROR state: ${batch.error ?? 'unknown'}`);
  }

  if (batch.status === 'QUEUED') {
    // updateMany with a status guard avoids a race between two claimers.
    const claimed = await prisma.externalAnalysisBatch.updateMany({
      where: { id: batchId, status: 'QUEUED' },
      data: {
        status: 'CLAIMED',
        claimedAt: new Date(),
        claimedBy: 'mcp',
      },
    });
    if (claimed.count === 0) {
      // Someone else won the race; re-read and carry on if now CLAIMED.
      const fresh = await prisma.externalAnalysisBatch.findUnique({ where: { id: batchId } });
      if (!fresh || (fresh.status !== 'CLAIMED' && fresh.status !== 'QUEUED')) {
        throw new Error(`batch ${batchId} no longer claimable (status=${fresh?.status})`);
      }
    }
  }

  // Load photos in the batch.photoIds order — this is the ordering that
  // commit_batch's photoIndices (1-based) references.
  const photos = await prisma.photo.findMany({ where: { id: { in: batch.photoIds } } });
  const byId = new Map(photos.map((p) => [p.id, p]));

  const out: GetBatchOutput['photos'] = [];
  for (let i = 0; i < batch.photoIds.length; i++) {
    const pid = batch.photoIds[i]!;
    const photo = byId.get(pid);
    if (!photo) throw new Error(`batch ${batchId}: photo ${pid} not found`);

    const source = photo.optimizedPath || photo.originalPath;
    if (!source || !fs.existsSync(source)) {
      throw new Error(`batch ${batchId}: photo ${pid} source missing on disk: ${source}`);
    }

    const raw = fs.readFileSync(source);
    const jpeg = await sharp(raw)
      .rotate()
      .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    out.push({
      index: i + 1,
      photoId: photo.id,
      filename: basename(photo.originalPath),
      imageBase64: jpeg.toString('base64'),
      mediaType: 'image/jpeg',
      capturedAt: photo.capturedAt?.toISOString() ?? null,
    });
  }

  return {
    id: batch.id,
    sourceFolder: batch.sourceFolder,
    photos: out,
    continuation: parseContinuation(batch.continuation),
  };
}

// ──────────────────────────────────────────────────────────────────────
// commit_batch
// ──────────────────────────────────────────────────────────────────────

export const CommitBatchInput = z.object({
  batchId: z.string().min(1),
  result: AnalysisResultSchema,
});

export interface CommitBatchOutput {
  ok: true;
  assignedItemIds: string[];
}

export async function commitBatchTool(
  prisma: PrismaClient,
  input: z.infer<typeof CommitBatchInput>,
  config: { publicImagesDir: string; publicImageBaseUrl: string },
): Promise<CommitBatchOutput> {
  return commitBatch({
    prisma,
    batchId: input.batchId,
    result: input.result,
    publicImagesDir: config.publicImagesDir,
    publicImageBaseUrl: config.publicImageBaseUrl,
  });
}

// ──────────────────────────────────────────────────────────────────────
// utils
// ──────────────────────────────────────────────────────────────────────

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function parseContinuation(
  raw: unknown,
): { itemId: string; itemTitle: string; representativePhotoPaths: string[] } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.itemId !== 'string') return undefined;
  return {
    itemId: obj.itemId,
    itemTitle: typeof obj.itemTitle === 'string' ? obj.itemTitle : '(no title)',
    representativePhotoPaths: Array.isArray(obj.representativePhotoPaths)
      ? obj.representativePhotoPaths.filter((x): x is string => typeof x === 'string')
      : [],
  };
}
