import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { postIngestPhoto } from './api.js';

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']);

export function watch(folder: string): FSWatcher {
  const watcher = chokidar.watch(folder, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    persistent: true,
  });

  watcher.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!PHOTO_EXTS.has(ext)) return;
    try {
      await postIngestPhoto(filePath);
      console.log('[ingest]', filePath);
    } catch (err) {
      console.error('[ingest-failed]', filePath, (err as Error).message);
    }
  });

  watcher.on('error', (err) => console.error('[watcher-error]', err));
  return watcher;
}
