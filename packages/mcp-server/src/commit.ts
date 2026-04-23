// Replay of ingest.service.ts#processCluster's DB transaction — but fed the
// AnalysisResult from an external worker (Claude Code / Desktop) via MCP
// instead of from a direct Anthropic API call.
//
// Keeps the HIGH_CONFIDENCE / LOW_CONFIDENCE thresholds and the continuation
// branch identical to IngestService, so there's a single source of truth for
// "what a cluster's analysis result means for the DB".

import fs from 'node:fs';
import path from 'node:path';
import slugify from 'slugify';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '../../server/src/generated/prisma/index.js';

// ──────────────────────────────────────────────────────────────────────
// Config constants — MIRROR ingest.service.ts
// ──────────────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE = 0.75;
const LOW_CONFIDENCE = 0.6;

// ──────────────────────────────────────────────────────────────────────
// Schemas — identical shape to ai.service.ts#AnalysisResultSchema.
// Duplicated here because we can't import the server package directly
// (the mcp-server is a sibling workspace with no build-time dep on it).
// ──────────────────────────────────────────────────────────────────────

export const ItemDraftSchema = z.object({
  title: z.string().max(120),
  description: z.string().optional(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  category: z.string().optional(),
  ebayCategoryId: z.string().optional(),
  condition: z.string().optional(),
  conditionId: z.number().int().optional(),
  features: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
  itemSpecifics: z.record(z.string()).optional().default({}),
  upc: z.string().optional().nullable(),
  isbn: z.string().optional().nullable(),
  mpn: z.string().optional().nullable(),
  estimatedValueUsd: z.number().optional(),
});

export const AnalysisResultSchema = z.object({
  groups: z.array(
    z.object({
      photoIndices: z.array(z.number().int()),
      isContinuationOfExistingItem: z.boolean().default(false),
      existingItemMatchConfidence: z.number().min(0).max(1).default(0),
      item: ItemDraftSchema,
      confidence: z.number().min(0).max(1).default(0),
    }),
  ),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ──────────────────────────────────────────────────────────────────────
// commitBatch — the core logic
// ──────────────────────────────────────────────────────────────────────

export interface CommitBatchArgs {
  prisma: PrismaClient;
  batchId: string;
  result: AnalysisResult;
  publicImagesDir: string;
  publicImageBaseUrl: string;
}

export interface CommitBatchOutput {
  ok: true;
  assignedItemIds: string[];
}

export async function commitBatch(args: CommitBatchArgs): Promise<CommitBatchOutput> {
  const { prisma, batchId, result } = args;

  const batch = await prisma.externalAnalysisBatch.findUnique({
    where: { id: batchId },
  });
  if (!batch) throw new Error(`batch ${batchId} not found`);
  if (batch.status === 'COMMITTED') {
    throw new Error(`batch ${batchId} already committed`);
  }
  if (batch.status !== 'CLAIMED' && batch.status !== 'QUEUED') {
    throw new Error(`batch ${batchId} in bad state ${batch.status}`);
  }

  // Load the photos in the order they appear in the batch. The index in
  // result.groups[].photoIndices is 1-based and addresses this exact ordering.
  const photos = await prisma.photo.findMany({
    where: { id: { in: batch.photoIds } },
  });
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const orderedPhotos = batch.photoIds
    .map((id) => photoById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  if (orderedPhotos.length !== batch.photoIds.length) {
    throw new Error(
      `batch ${batchId}: ${batch.photoIds.length - orderedPhotos.length} photo(s) not found`,
    );
  }

  // Continuation hint stored on the batch when it was queued. Two shapes:
  //   - { groupId }        — manual-trigger path. Existing PhotoGroup; we
  //                          create the Item INTO that group and set the
  //                          Item.status = IN_PROCESS.
  //   - { itemId, ... }    — legacy auto-ingest continuation (unused since
  //                          the watcher stopped auto-identifying, but kept
  //                          for back-compat with any in-flight batches).
  const continuation =
    batch.continuation && typeof batch.continuation === 'object'
      ? (batch.continuation as { groupId?: string; itemId?: string; itemTitle?: string })
      : null;
  const isManualTrigger = !!continuation?.groupId;

  const assignedItemIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    let group;
    if (isManualTrigger) {
      const existing = await tx.photoGroup.findUnique({
        where: { id: continuation!.groupId! },
      });
      if (!existing) throw new Error(`batch ${batchId}: group ${continuation!.groupId} not found`);
      group = await tx.photoGroup.update({
        where: { id: existing.id },
        data: { status: 'ANALYZING', llmDecision: result as unknown as Prisma.InputJsonValue },
      });
    } else {
      const firstCapturedAt = orderedPhotos
        .map((p) => p.capturedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const lastCapturedAt = orderedPhotos
        .map((p) => p.capturedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const filenameNumerics = orderedPhotos
        .map((p) => filenameNumericSuffix(path.basename(p.originalPath)))
        .filter((n): n is number => n !== null);
      group = await tx.photoGroup.create({
        data: {
          sourceFolder: batch.sourceFolder,
          firstFilenameNumeric: filenameNumerics[0] ?? null,
          lastFilenameNumeric: filenameNumerics[filenameNumerics.length - 1] ?? null,
          firstCapturedAt: firstCapturedAt ?? null,
          lastCapturedAt: lastCapturedAt ?? null,
          status: 'ANALYZING',
          llmDecision: result as unknown as Prisma.InputJsonValue,
        },
      });
    }

    for (const aiGroup of result.groups) {
      const memberPhotoIds = aiGroup.photoIndices
        .map((idx) => orderedPhotos[idx - 1]?.id)
        .filter((id): id is string => !!id);
      if (memberPhotoIds.length === 0) continue;

      const isContinuation =
        !isManualTrigger &&
        aiGroup.isContinuationOfExistingItem &&
        aiGroup.existingItemMatchConfidence >= HIGH_CONFIDENCE &&
        continuation?.itemId;

      let itemId: string;
      let decision: 'NEW_ITEM' | 'ADDED_TO_ITEM' | 'GROUPED_PENDING';

      // Low-confidence auto-ingest path → leave photos in group. Manual
      // trigger always creates an Item (the user explicitly asked).
      if (aiGroup.confidence < LOW_CONFIDENCE && !isContinuation && !isManualTrigger) {
        await tx.photoGroup.update({
          where: { id: group.id },
          data: { status: 'PENDING' },
        });
        await tx.photo.updateMany({
          where: { id: { in: memberPhotoIds } },
          data: { photoGroupId: group.id },
        });
        for (const _pid of memberPhotoIds) {
          await tx.ingestEvent.create({
            data: {
              path: '',
              sha256: '',
              decision: 'GROUPED_PENDING',
              groupId: group.id,
              // No LLM cost — the external worker paid (via their Claude Max sub).
              llmCostUsd: 0,
            },
          });
        }
        continue;
      }

      if (isContinuation) {
        itemId = continuation!.itemId!;
        decision = 'ADDED_TO_ITEM';
        // No aiCost increment — external-MCP path didn't pay Anthropic.
      } else {
        const draft = aiGroup.item;
        const newItem = await tx.item.create({
          data: {
            title: draft.title,
            description: draft.description,
            brand: draft.brand ?? null,
            model: draft.model ?? null,
            category: draft.category,
            ebayCategoryId: draft.ebayCategoryId,
            condition: draft.condition,
            conditionId: draft.conditionId,
            features: draft.features,
            keywords: draft.keywords,
            itemSpecifics: draft.itemSpecifics as unknown as Prisma.InputJsonValue,
            upc: draft.upc ?? null,
            isbn: draft.isbn ?? null,
            mpn: draft.mpn ?? null,
            // Manual-trigger path: Item lands in IN_PROCESS (user hasn't
            // confirmed it's ready for listing yet).
            status: isManualTrigger ? 'IN_PROCESS' : 'DRAFT',
            stage: 'IDENTIFIED',
            sourceFolder: batch.sourceFolder,
            aiAnalysis: aiGroup as unknown as Prisma.InputJsonValue,
            // External-MCP path: no Anthropic spend on our account.
            aiCost: 0,
          },
        });
        itemId = newItem.id;
        decision = 'NEW_ITEM';
      }

      await tx.photo.updateMany({
        where: { id: { in: memberPhotoIds } },
        data: { itemId, photoGroupId: group.id },
      });

      // First assignment wins the group label. If there were multiple AI
      // groups inside one user group, only the first gets the existing
      // PhotoGroup — extras would need their own groups, but we don't
      // currently support that (fine for single-item photo sets).
      if (group.itemId === null) {
        const itemTitle = await tx.item
          .findUnique({ where: { id: itemId }, select: { title: true } })
          .then((i) => i?.title ?? null);
        await tx.photoGroup.update({
          where: { id: group.id },
          data: { itemId, status: 'ASSIGNED', label: itemTitle ?? undefined },
        });
      }

      for (const _pid of memberPhotoIds) {
        await tx.ingestEvent.create({
          data: {
            path: '',
            sha256: '',
            decision,
            itemId,
            groupId: group.id,
            llmCostUsd: 0,
          },
        });
      }

      if (!assignedItemIds.includes(itemId)) assignedItemIds.push(itemId);
    }

    await tx.externalAnalysisBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMMITTED',
        committedAt: new Date(),
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
  });

  // Post-commit (outside tx): host images + recompute completeness.
  for (const itemId of assignedItemIds) {
    try {
      await hostItemImages(prisma, itemId, args.publicImagesDir, args.publicImageBaseUrl);
    } catch (err) {
      // Non-fatal — the commit already landed.
      console.error(`[mcp] hostItemImages failed for ${itemId}:`, (err as Error).message);
    }
    try {
      await recomputeCompleteness(prisma, itemId);
    } catch (err) {
      console.error(`[mcp] recomputeCompleteness failed for ${itemId}:`, (err as Error).message);
    }
  }

  return { ok: true, assignedItemIds };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers — inlined from util/exif.ts, imageHosting.service.ts,
// util/completeness.ts so the MCP server has no server-package imports
// beyond the generated Prisma client.
// ──────────────────────────────────────────────────────────────────────

function filenameNumericSuffix(filename: string): number | null {
  const stem = filename.replace(/\.[^.]+$/, '');
  const match = stem.match(/(\d+)(?!.*\d)/);
  return match && match[1] ? Number.parseInt(match[1], 10) : null;
}

function makeSlug(title: string | null | undefined, idSuffix: string): string {
  const base = slugify(title || 'item', { lower: true, strict: true }).slice(0, 60);
  return `${base || 'item'}-${idSuffix}`;
}

async function hostItemImages(
  prisma: PrismaClient,
  itemId: string,
  publicImagesDir: string,
  publicImageBaseUrl: string,
): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: { orderBy: { order: 'asc' } } },
  });
  if (!item || item.photos.length === 0) return;

  const slug = makeSlug(item.title, item.id.slice(-8));
  const destDir = path.resolve(publicImagesDir, 'swiftlist', slug);
  fs.mkdirSync(destDir, { recursive: true });

  for (let i = 0; i < item.photos.length; i++) {
    const photo = item.photos[i]!;
    const sourcePath = photo.optimizedPath || photo.originalPath;
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;

    const ext = path.extname(sourcePath) || '.jpg';
    const filename = `image${i + 1}${ext}`;
    const destPath = path.join(destDir, filename);
    fs.copyFileSync(sourcePath, destPath);

    const publicUrl = `${publicImageBaseUrl}/public-images/swiftlist/${slug}/${filename}`;
    await prisma.photo.update({ where: { id: photo.id }, data: { publicUrl } });
  }
}

interface CompletenessReport {
  score: number;
  missing: string[];
  checks: Record<string, boolean>;
}

async function recomputeCompleteness(prisma: PrismaClient, itemId: string): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: { select: { id: true } } },
  });
  if (!item) return;

  const checks: Record<string, boolean> = {
    hasPhotos: item.photos.length > 0,
    hasTitle: !!item.title?.trim(),
    hasDescription: !!item.description?.trim(),
    hasCategory: !!item.ebayCategoryId || !!item.category?.trim(),
    hasCondition: !!item.condition?.trim(),
    hasPrice: item.startingPrice !== null || item.buyNowPrice !== null,
    hasShipping: item.shippingPrice !== null || item.weightOz !== null,
    hasSpecifics:
      !!item.itemSpecifics &&
      typeof item.itemSpecifics === 'object' &&
      Object.keys(item.itemSpecifics as Record<string, unknown>).length > 0,
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = Math.round((passed / total) * 100);
  const missing = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const report: CompletenessReport = { score, missing, checks };

  await prisma.item.update({
    where: { id: itemId },
    data: { completeness: report as unknown as Prisma.InputJsonValue },
  });
}
