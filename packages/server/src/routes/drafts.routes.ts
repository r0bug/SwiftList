// Endpoints that power the eBay draft-resume flow used by content-draft.js
// and content-drafts-list.js in the extension.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { apiKeyAuth, apiKeyOrJwt, jwtAuth } from '../middleware/auth.js';
import { buildAutofillPayload, buildDeltaPayload } from '../services/draft.service.js';
import { qstr, pstr } from '../util/req.js';
import type { Prisma } from '../generated/prisma/index.js';

const router = Router();

// GET /api/v1/drafts — list latest drafts with their linked Item (web UI).
router.get('/', jwtAuth, async (req, res) => {
  const cursor = qstr(req.query.cursor);
  const take = Math.min(Number(qstr(req.query.limit)) || 50, 200);

  const drafts = await prisma.ebayDraft.findMany({
    include: {
      item: { select: { id: true, title: true, brand: true } },
    },
    take: take + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { lastSeenAt: 'desc' },
  });

  const nextCursor = drafts.length > take ? drafts.pop()?.id ?? null : null;
  res.json({ drafts, nextCursor });
});

// GET /api/v1/drafts/by-url?url=…
router.get('/by-url', apiKeyAuth, async (req, res) => {
  const url = qstr(req.query.url);
  if (!url) {
    res.status(400).json({ error: 'url query required' });
    return;
  }
  const draft = await prisma.ebayDraft.findFirst({
    where: { ebayDraftUrl: url },
    include: { item: true },
  });
  if (!draft) {
    res.status(404).json({ error: 'Draft not linked' });
    return;
  }
  const autofill = await buildAutofillPayload(draft.itemId, draft.id);
  const { item, ...draftCore } = draft;
  res.json({ draft: draftCore, item, autofill });
});

router.get('/by-ebay-id/:ebayDraftId', apiKeyAuth, async (req, res) => {
  const draft = await prisma.ebayDraft.findUnique({
    where: { ebayDraftId: pstr(req.params.ebayDraftId) },
    include: { item: true },
  });
  if (!draft) {
    res.status(404).json({ error: 'Draft not linked' });
    return;
  }
  const autofill = await buildAutofillPayload(draft.itemId, draft.id);
  const { item, ...draftCore } = draft;
  res.json({ draft: draftCore, item, autofill });
});

// PATCH /api/v1/drafts/:id — heartbeat from content-draft.js + submission flip.
const PatchSchema = z.object({
  currentValues: z.record(z.unknown()).optional(),
  lastFilledFields: z.array(z.string()).optional(),
  status: z.enum(['OPEN', 'SUBMITTED', 'ABANDONED', 'UNKNOWN']).optional(),
  ebayItemId: z.string().optional(),
});

router.patch('/:id', apiKeyOrJwt, async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const { ebayItemId, currentValues, lastFilledFields, status } = parsed.data;
  const draft = await prisma.ebayDraft.update({
    where: { id: pstr(req.params.id) },
    data: {
      status,
      currentValues: currentValues as unknown as Prisma.InputJsonValue | undefined,
      lastFilledFields: lastFilledFields as unknown as Prisma.InputJsonValue | undefined,
      lastSeenAt: new Date(),
      lastFilledAt: lastFilledFields ? new Date() : undefined,
    },
  });

  if (ebayItemId && status === 'SUBMITTED') {
    await prisma.item.update({
      where: { id: draft.itemId },
      data: {
        ebayItemId,
        ebayListingUrl: `https://www.ebay.com/itm/${ebayItemId}`,
        status: 'LISTED',
        stage: 'READY',
      },
    });
  }

  res.json(draft);
});

// POST /api/v1/drafts/:id/resume — returns the delta autofill payload.
router.post('/:id/resume', apiKeyAuth, async (req, res) => {
  const delta = await buildDeltaPayload(pstr(req.params.id));
  res.json(delta);
});

export default router;
