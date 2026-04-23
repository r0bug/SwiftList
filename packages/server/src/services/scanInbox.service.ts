// Recursively walks a folder and enqueues every image file with the
// ingest service. The ingest service dedupes by sha256, so re-running the
// scan is safe — unchanged files are silently skipped as DUPLICATE_SKIPPED.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ingestService } from './ingest.service.js';
import { logger } from '../util/logger.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
const MAX_FILES = 5000;

export interface ScanResult {
  folder: string;
  scanned: number;
  enqueued: number;
  skippedNonImage: number;
  truncated: boolean;
}

export async function scanInbox(folder: string): Promise<ScanResult> {
  const result: ScanResult = {
    folder,
    scanned: 0,
    enqueued: 0,
    skippedNonImage: 0,
    truncated: false,
  };

  async function walk(dir: string): Promise<void> {
    if (result.enqueued >= MAX_FILES) {
      result.truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, dir }, 'scanInbox: cannot read dir');
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip obvious noise.
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      result.scanned += 1;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        result.skippedNonImage += 1;
        continue;
      }
      ingestService.enqueue(full);
      result.enqueued += 1;
      if (result.enqueued >= MAX_FILES) {
        result.truncated = true;
        return;
      }
    }
  }

  await walk(folder);
  return result;
}
