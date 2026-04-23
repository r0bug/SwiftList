// Extension-only endpoints: registration, identify-search queue, hot-patch,
// telemetry. Most are direct ports of comptool patterns.

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { apiKeyAuth } from '../middleware/auth.js';
import { sha256String } from '../util/sha256.js';
import { logger } from '../util/logger.js';

const router = Router();

// POST /api/v1/extension/register — public; issues an API key for first install.
const RegisterSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
});

router.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const client = await prisma.client.create({
    data: { name: parsed.data.name, email: parsed.data.email },
  });
  const rawKey = `sl_${randomBytes(24).toString('hex')}`;
  await prisma.apiKey.create({
    data: { clientId: client.id, keyHash: sha256String(rawKey), name: 'default' },
  });
  res.status(201).json({ apiKey: rawKey, clientId: client.id });
});

// POST /api/v1/extension/identify-search — returns Items needing comp matches
// + a generated eBay sold-search URL each.
router.post('/identify-search', apiKeyAuth, async (_req, res) => {
  const items = await prisma.item.findMany({
    where: {
      OR: [{ stage: 'IDENTIFIED' }, { stage: 'GROUPED' }, { stage: 'INGESTED' }],
      soldComps: { none: {} },
    },
    take: 25,
    orderBy: { updatedAt: 'desc' },
    include: { photos: { take: 1, where: { isPrimary: true } } },
  });

  const enriched = items.map((item) => {
    const queryParts = [item.brand, item.model, item.title].filter(Boolean).map(String);
    const q = queryParts.join(' ').slice(0, 100);
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;
    return { id: item.id, title: item.title, brand: item.brand, query: q, soldSearchUrl: url };
  });

  res.json({ items: enriched });
});

// GET /api/v1/extension/patch — hot-patch payload (mirror comptool).
router.get('/patch', apiKeyAuth, async (_req, res) => {
  const setting = await prisma.setting.findUnique({ where: { key: 'extensionPatch' } });
  if (!setting) {
    res.json({ version: 0, scripts: {} });
    return;
  }
  res.json(setting.value);
});

// POST /api/v1/extension/telemetry — selector-failure logging.
router.post('/telemetry', apiKeyAuth, async (req, res) => {
  logger.warn({ telemetry: req.body, client: req.client?.id }, 'extension telemetry');
  res.json({ ok: true });
});

export default router;
