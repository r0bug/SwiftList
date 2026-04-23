import { Router } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth.js';
import { ingestService } from '../services/ingest.service.js';

const router = Router();
router.use(apiKeyAuth);

const IngestPhotoSchema = z.object({
  path: z.string().min(1),
  watchFolderId: z.string().optional(),
});

router.post('/photo', (req, res) => {
  const parsed = IngestPhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const { jobId } = ingestService.enqueue(parsed.data.path, parsed.data.watchFolderId);
  res.status(202).json({ jobId, status: 'queued' });
});

export default router;
