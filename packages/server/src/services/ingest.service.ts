// Ingestion pipeline orchestrator.
//
//   watcher → POST /api/v1/ingest/photo (per file)
//   server queues by dirname, debounces 1500ms
//   on flush:
//     for each file:
//       sha256 → dedup check
//       exif + perceptualHash
//       sharp optimized + thumbnail
//       persist Photo (no item yet, no group yet)
//     cluster the batch (deterministic) → candidate PhotoGroups
//     for each candidate, look for an in-folder Item to continue
//     send each candidate to Claude (multi-image), with continuation hint
//     persist results in one transaction:
//       create new Items OR attach photos to existing Item
//       upsert PhotoGroup, update photos, write IngestEvents
//       recompute Item.completeness

import path from 'node:path';
import type { Prisma } from '../generated/prisma/index.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../util/logger.js';
import { sha256File } from '../util/sha256.js';
import { perceptualHash } from '../util/perceptualHash.js';
import { readExif, filenameNumericSuffix } from '../util/exif.js';
import { processImage, pendingGroupDir } from './image.service.js';
import { clusterPhotos, type PhotoCandidate } from './grouping.service.js';
import { aiService, type PhotoForAnalysis } from './ai.service.js';
import { computeCompleteness } from '../util/completeness.js';
import { hostItemImages } from './imageHosting.service.js';

const DEBOUNCE_MS = 1500;
const CONTINUATION_LOOKBACK_MS = 5 * 60_000;
const HIGH_CONFIDENCE = 0.75;
const LOW_CONFIDENCE = 0.6;

interface PendingFile {
  path: string;
  watchFolderId?: string;
  arrivedAt: number;
}

export interface IngestStatus {
  pending: number; // files enqueued, not yet flushed (awaiting debounce)
  processing: number; // files currently inside flushBatch/processCluster
  totalQueued: number; // lifetime: enqueues accepted (deduped by path within a batch would count once per enqueue call)
  totalProcessed: number; // lifetime: files that finished the pipeline (persisted/assigned/pended)
  totalErrors: number; // lifetime: per-file errors
  totalDuplicates: number; // lifetime: sha-256 duplicates skipped
  totalAiCalls: number; // lifetime: successful aiService.analyze calls
  totalAiCostUsd: number; // lifetime: cumulative AI spend
  lastEventAt: string | null;
}

class IngestService {
  private byDir = new Map<string, { files: PendingFile[]; timer: NodeJS.Timeout }>();
  private status: IngestStatus = {
    pending: 0,
    processing: 0,
    totalQueued: 0,
    totalProcessed: 0,
    totalErrors: 0,
    totalDuplicates: 0,
    totalAiCalls: 0,
    totalAiCostUsd: 0,
    lastEventAt: null,
  };

  getStatus(): IngestStatus {
    return { ...this.status };
  }

  private bump<K extends keyof IngestStatus>(key: K, by: IngestStatus[K] extends number ? number : never) {
    (this.status[key] as number) = (this.status[key] as number) + (by as number);
    this.status.lastEventAt = new Date().toISOString();
  }

  enqueue(filePath: string, watchFolderId?: string): { jobId: string } {
    const dir = path.dirname(filePath);
    const entry =
      this.byDir.get(dir) ??
      (() => {
        const fresh = { files: [] as PendingFile[], timer: setTimeout(() => {}, 0) };
        this.byDir.set(dir, fresh);
        return fresh;
      })();

    entry.files.push({ path: filePath, watchFolderId, arrivedAt: Date.now() });
    this.status.pending += 1;
    this.bump('totalQueued', 1);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.byDir.delete(dir);
      this.flushBatch(dir, entry.files).catch((err) =>
        logger.error({ err, dir }, 'ingest flush failed'),
      );
    }, DEBOUNCE_MS);

    return { jobId: `${dir}:${entry.files.length}` };
  }

  private async flushBatch(sourceFolder: string, files: PendingFile[]): Promise<void> {
    logger.info({ sourceFolder, count: files.length }, 'ingest batch flush');
    this.status.pending = Math.max(0, this.status.pending - files.length);
    this.status.processing += files.length;

    // Step 1: per-file persistence. Photos are inserted unattached.
    const persisted: PhotoCandidate[] = [];
    for (const f of files) {
      try {
        const sha256 = await sha256File(f.path);
        const existing = await prisma.photo.findUnique({ where: { sha256 } });
        if (existing) {
          await prisma.ingestEvent.create({
            data: { path: f.path, sha256, decision: 'DUPLICATE_SKIPPED' },
          });
          this.bump('totalDuplicates', 1);
          this.bump('totalProcessed', 1);
          continue;
        }

        const exif = await readExif(f.path);
        const phash = await perceptualHash(f.path).catch(() => null);
        const filename = path.basename(f.path);
        const numeric = filenameNumericSuffix(filename);

        // Pre-LLM the working files live in pending-<groupId>; we don't have
        // a groupId yet, so use the source filename's stem as a temp container.
        const tempDir = pendingGroupDir(sha256.slice(0, 8));
        const processed = await processImage(f.path, tempDir, sha256.slice(0, 12));

        const photo = await prisma.photo.create({
          data: {
            originalPath: f.path,
            optimizedPath: processed.optimizedPath,
            thumbnailPath: processed.thumbnailPath,
            sha256,
            perceptualHash: phash,
            width: processed.width,
            height: processed.height,
            bytes: processed.bytes,
            mime: processed.mime,
            capturedAt: exif.capturedAt,
            exif: (exif.raw as unknown as Prisma.InputJsonValue | undefined) ?? undefined,
          },
        });

        persisted.push({
          id: photo.id,
          sourceFolder,
          filename,
          filenameNumeric: numeric,
          capturedAt: exif.capturedAt,
          perceptualHash: phash,
        });
      } catch (err) {
        logger.error({ err, file: f.path }, 'per-file ingest failed');
        await prisma.ingestEvent.create({
          data: {
            path: f.path,
            sha256: '',
            decision: 'ERROR',
            error: (err as Error).message,
          },
        });
        this.bump('totalErrors', 1);
        this.bump('totalProcessed', 1);
      }
    }

    // Persisted files count toward totalProcessed once their cluster resolves.
    if (persisted.length === 0) {
      this.status.processing = Math.max(0, this.status.processing - files.length);
      return;
    }

    // Step 2: cluster.
    const { clusters } = clusterPhotos(persisted);
    logger.info({ clusters: clusters.length }, 'clustered batch');

    // Step 3: per-cluster LLM disambiguation.
    for (const cluster of clusters) {
      try {
        await this.processCluster(cluster, sourceFolder);
        this.bump('totalProcessed', cluster.length);
      } catch (err) {
        logger.error({ err, sourceFolder }, 'cluster processing failed');
        this.bump('totalErrors', cluster.length);
        this.bump('totalProcessed', cluster.length);
      }
    }
    // processing -= file count for this batch; use files.length so pre-AI
    // errors are also drained.
    this.status.processing = Math.max(0, this.status.processing - files.length);
  }

  private async processCluster(cluster: PhotoCandidate[], sourceFolder: string): Promise<void> {
    // Continuation candidate: most recent ASSIGNED group in same folder within 5 min.
    const recentGroup = await prisma.photoGroup.findFirst({
      where: {
        sourceFolder,
        status: 'ASSIGNED',
        itemId: { not: null },
        lastCapturedAt: { gte: new Date(Date.now() - CONTINUATION_LOOKBACK_MS) },
      },
      orderBy: { lastCapturedAt: 'desc' },
      include: { item: true, photos: { take: 2, orderBy: { order: 'asc' } } },
    });

    const photosForAi: PhotoForAnalysis[] = await Promise.all(
      cluster.map(async (p, i) => {
        const photo = await prisma.photo.findUnique({ where: { id: p.id } });
        return {
          index: i + 1,
          filePath: photo?.optimizedPath || photo?.originalPath || '',
          filename: p.filename,
          capturedAt: p.capturedAt,
          perceptualHash: p.perceptualHash,
        };
      }),
    );

    const continuation =
      recentGroup?.item && recentGroup.photos.length > 0
        ? {
            itemId: recentGroup.item.id,
            itemTitle: recentGroup.item.title ?? '(no title)',
            representativePhotoPaths: recentGroup.photos
              .map((p) => p.optimizedPath || p.originalPath)
              .filter(Boolean) as string[],
          }
        : undefined;

    const { result, costUsd } = await aiService.analyze({
      photos: photosForAi,
      continuation,
    });
    this.bump('totalAiCalls', 1);
    this.bump('totalAiCostUsd', costUsd);

    // Step 4: persist results in a transaction.
    await prisma.$transaction(async (tx) => {
      const firstCapturedAt = cluster
        .map((c) => c.capturedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const lastCapturedAt = cluster
        .map((c) => c.capturedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const filenameNumerics = cluster
        .map((c) => c.filenameNumeric)
        .filter((n): n is number => n !== null);

      const group = await tx.photoGroup.create({
        data: {
          sourceFolder,
          firstFilenameNumeric: filenameNumerics[0] ?? null,
          lastFilenameNumeric: filenameNumerics[filenameNumerics.length - 1] ?? null,
          firstCapturedAt: firstCapturedAt ?? null,
          lastCapturedAt: lastCapturedAt ?? null,
          status: 'ANALYZING',
          llmDecision: result as unknown as Prisma.InputJsonValue,
        },
      });

      for (const aiGroup of result.groups) {
        const memberPhotoIds = aiGroup.photoIndices
          .map((idx) => cluster[idx - 1]?.id)
          .filter((id): id is string => !!id);
        if (memberPhotoIds.length === 0) continue;

        const isContinuation =
          aiGroup.isContinuationOfExistingItem &&
          aiGroup.existingItemMatchConfidence >= HIGH_CONFIDENCE &&
          continuation;

        let itemId: string;
        let decision: 'NEW_ITEM' | 'ADDED_TO_ITEM' | 'GROUPED_PENDING';

        if (aiGroup.confidence < LOW_CONFIDENCE && !isContinuation) {
          // Low confidence: leave photos in the group, no Item yet.
          await tx.photoGroup.update({
            where: { id: group.id },
            data: { status: 'PENDING' },
          });
          await tx.photo.updateMany({
            where: { id: { in: memberPhotoIds } },
            data: { photoGroupId: group.id },
          });
          for (const pid of memberPhotoIds) {
            await tx.ingestEvent.create({
              data: {
                path: '',
                sha256: '',
                decision: 'GROUPED_PENDING',
                groupId: group.id,
                llmCostUsd: costUsd,
              },
            });
          }
          continue;
        }

        if (isContinuation) {
          itemId = continuation.itemId;
          decision = 'ADDED_TO_ITEM';
          await tx.item.update({
            where: { id: itemId },
            data: { aiCost: { increment: costUsd } },
          });
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
              status: 'DRAFT',
              stage: 'IDENTIFIED',
              sourceFolder,
              aiAnalysis: aiGroup as unknown as Prisma.InputJsonValue,
              aiCost: costUsd,
            },
          });
          itemId = newItem.id;
          decision = 'NEW_ITEM';
        }

        await tx.photo.updateMany({
          where: { id: { in: memberPhotoIds } },
          data: { itemId, photoGroupId: group.id },
        });

        await tx.photoGroup.update({
          where: { id: group.id },
          data: { itemId, status: 'ASSIGNED' },
        });

        for (const pid of memberPhotoIds) {
          await tx.ingestEvent.create({
            data: {
              path: '',
              sha256: '',
              decision,
              itemId,
              groupId: group.id,
              llmCostUsd: costUsd,
            },
          });
        }
      }
    });

    // Step 5: rename pending dirs to real slug + recompute completeness.
    // Done outside the transaction since it touches the filesystem.
    if (recentGroup) await this.recomputeCompleteness(recentGroup.itemId!);
    for (const aiGroup of result.groups) {
      const firstPhotoIdx = aiGroup.photoIndices[0];
      if (firstPhotoIdx === undefined) continue;
      const photo = await prisma.photo.findUnique({
        where: { id: cluster[firstPhotoIdx - 1]!.id },
      });
      if (photo?.itemId) {
        await hostItemImages(photo.itemId).catch((err) =>
          logger.error({ err, itemId: photo.itemId }, 'hostItemImages failed'),
        );
        await this.recomputeCompleteness(photo.itemId);
      }
    }
  }

  private async recomputeCompleteness(itemId: string): Promise<void> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: { photos: { select: { id: true } } },
    });
    if (!item) return;
    const report = computeCompleteness({ ...item, hasPhotos: item.photos.length > 0 });
    await prisma.item.update({
      where: { id: itemId },
      data: { completeness: report as unknown as Prisma.InputJsonValue },
    });
  }
}

export const ingestService = new IngestService();
