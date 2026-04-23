import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { apiKeyAuth, apiKeyOrJwt } from '../middleware/auth.js';
import { ingestService } from '../services/ingest.service.js';
import { scanInbox } from '../services/scanInbox.service.js';
import { env } from '../config/env.js';

const router = Router();

const IngestPhotoSchema = z.object({
  path: z.string().min(1),
  watchFolderId: z.string().optional(),
});

router.post('/photo', apiKeyAuth, (req, res) => {
  const parsed = IngestPhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const { jobId } = ingestService.enqueue(parsed.data.path, parsed.data.watchFolderId);
  res.status(202).json({ jobId, status: 'queued' });
});

function resolveWatchFolder(override?: string): string {
  const raw = (override && override.trim()) || env.SWIFTLIST_WATCH_FOLDER || path.join(process.cwd(), 'inbox');
  return path.resolve(raw);
}

const ScanSchema = z.object({ folder: z.string().optional() });

router.post('/scan', apiKeyOrJwt, async (req, res) => {
  const parsed = ScanSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const folder = resolveWatchFolder(parsed.data.folder);
  if (!fs.existsSync(folder)) {
    res.status(404).json({ error: `Watch folder does not exist: ${folder}` });
    return;
  }
  const result = await scanInbox(folder);
  res.json({ ...result, status: ingestService.getStatus() });
});

router.get('/status', apiKeyOrJwt, (_req, res) => {
  res.json({
    status: ingestService.getStatus(),
    watchFolder: resolveWatchFolder(),
  });
});

export default router;
