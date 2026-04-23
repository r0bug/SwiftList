// Ingestion pipeline orchestrator.
//
//   watcher → POST /api/v1/ingest/photo (per file)
//   server queues by dirname, debounces 1500ms
//   on flush:
//     for each file:
//       sha256 → dedup check
//       exif + perceptualHash
//       sharp optimized + thumbnail
//       persist Photo (unattached: no item, no group)
//
// Manual-grouping mode (2026-04): the pipeline stops here. Photos live in
// the pool until the user explicitly groups them and triggers identification
// from the /groups UI. Clustering + LLM analysis are driven by dedicated
// endpoints rather than by the watcher.

import path from 'node:path';
import type { Prisma } from '../generated/prisma/index.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../util/logger.js';
import { sha256File } from '../util/sha256.js';
import { perceptualHash } from '../util/perceptualHash.js';
import { readExif, filenameNumericSuffix } from '../util/exif.js';
import { processImage, pendingGroupDir } from './image.service.js';

const DEBOUNCE_MS = 1500;

interface PendingFile {
  path: string;
  watchFolderId?: string;
  arrivedAt: number;
}

interface PersistedPhoto {
  id: string;
  sourceFolder: string;
  filename: string;
  filenameNumeric: number | null;
  capturedAt: Date | null;
  perceptualHash: string | null;
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
    const persisted: PersistedPhoto[] = [];
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

    // Manual-grouping mode (2026-04): photos land in the pool (itemId +
    // photoGroupId both null) and stay there until the user explicitly
    // groups them and triggers identification. No auto-cluster, no auto-LLM,
    // no auto-queue to external-MCP.
    this.bump('totalProcessed', persisted.length);
    this.status.processing = Math.max(0, this.status.processing - files.length);
  }

}

export const ingestService = new IngestService();
