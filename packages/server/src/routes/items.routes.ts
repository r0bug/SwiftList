import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { jwtAuth, apiKeyAuth, apiKeyOrJwt } from '../middleware/auth.js';
import { buildAutofillPayload } from '../services/draft.service.js';
import { computeCompleteness } from '../util/completeness.js';
import { qstr, pstr } from '../util/req.js';
import type { Prisma } from '../generated/prisma/index.js';

const router = Router();

const ItemStatuses = ['DRAFT', 'READY', 'LISTED', 'SOLD', 'ARCHIVED'] as const;
const ItemStages = ['INGESTED', 'GROUPED', 'IDENTIFIED', 'MATCHED', 'DRAFT_STARTED', 'READY'] as const;
type ItemStatus = (typeof ItemStatuses)[number];
type ItemStage = (typeof ItemStages)[number];

// ── List + read ────────────────────────────────────────────────────────

router.get('/', jwtAuth, async (req, res) => {
  const status = qstr(req.query.status);
  const stage = qstr(req.query.stage);
  const q = qstr(req.query.q);
  const cursor = qstr(req.query.cursor);
  const take = Math.min(Number(qstr(req.query.limit)) || 50, 200);

  const items = await prisma.item.findMany({
    where: {
      status: status && ItemStatuses.includes(status as ItemStatus) ? (status as ItemStatus) : undefined,
      stage: stage && ItemStages.includes(stage as ItemStage) ? (stage as ItemStage) : undefined,
      title: q ? { contains: q, mode: 'insensitive' } : undefined,
    },
    include: {
      photos: { take: 1, where: { isPrimary: true } },
      _count: { select: { photos: true, soldComps: true, drafts: true } },
    },
    take: take + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { updatedAt: 'desc' },
  });

  const nextCursor = items.length > take ? items.pop()?.id : null;
  res.json({ items, nextCursor });
});

router.get('/:id', jwtAuth, async (req, res) => {
  const item = await prisma.item.findUnique({
    where: { id: pstr(req.params.id) },
    include: {
      photos: { orderBy: { order: 'asc' } },
      soldComps: { orderBy: { scrapedAt: 'desc' } },
      drafts: { orderBy: { lastSeenAt: 'desc' } },
    },
  });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(item);
});

// ── Update ─────────────────────────────────────────────────────────────

const ItemPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  category: z.string().optional(),
  ebayCategoryId: z.string().optional(),
  condition: z.string().optional(),
  conditionId: z.number().int().optional(),
  features: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  itemSpecifics: z.record(z.unknown()).optional(),
  upc: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  mpn: z.string().nullable().optional(),
  startingPrice: z.number().optional(),
  buyNowPrice: z.number().optional(),
  shippingPrice: z.number().optional(),
  weightOz: z.number().optional(),
  packageDimensions: z.object({ length: z.number(), width: z.number(), height: z.number() }).optional(),
  listingFormat: z.string().optional(),
  listingDuration: z.string().optional(),
  postalCode: z.string().optional(),
  status: z.enum(ItemStatuses).optional(),
  stage: z.enum(ItemStages).optional(),
  ebayItemId: z.string().optional(),
  ebayListingUrl: z.string().optional(),
});

router.patch('/:id', jwtAuth, async (req, res) => {
  const parsed = ItemPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const data = parsed.data as Prisma.ItemUpdateInput;
  const updated = await prisma.item.update({
    where: { id: pstr(req.params.id) },
    data,
    include: { photos: { select: { id: true } } },
  });
  const report = computeCompleteness({ ...updated, hasPhotos: updated.photos.length > 0 });
  await prisma.item.update({
    where: { id: updated.id },
    data: { completeness: report as unknown as Prisma.InputJsonValue },
  });
  res.json({ ...updated, completeness: report });
});

// ── Photos ────────────────────────────────────────────────────────────

router.post('/:id/photos/reorder', jwtAuth, async (req, res) => {
  const { photoIds } = req.body as { photoIds?: string[] };
  if (!Array.isArray(photoIds)) {
    res.status(400).json({ error: 'photoIds must be an array' });
    return;
  }
  await prisma.$transaction(
    photoIds.map((pid, idx) => prisma.photo.update({ where: { id: pid }, data: { order: idx } })),
  );
  res.json({ ok: true });
});

router.post('/:id/photos/:photoId/primary', jwtAuth, async (req, res) => {
  const id = pstr(req.params.id);
  const photoId = pstr(req.params.photoId);
  await prisma.$transaction([
    prisma.photo.updateMany({ where: { itemId: id }, data: { isPrimary: false } }),
    prisma.photo.update({ where: { id: photoId }, data: { isPrimary: true } }),
  ]);
  res.json({ ok: true });
});

router.delete('/:id/photos/:photoId', jwtAuth, async (req, res) => {
  await prisma.photo.delete({ where: { id: pstr(req.params.photoId) } });
  res.json({ ok: true });
});

// ── Autofill payload (extension reads this) ───────────────────────────

router.get('/:id/autofill', apiKeyAuth, async (req, res) => {
  const payload = await buildAutofillPayload(pstr(req.params.id));
  res.json(payload);
});

// ── Sold-comp link (extension posts here from content-sold/detail) ────

const SoldCompLinkSchema = z.object({
  ebayItemId: z.string(),
  soldPrice: z.number().optional(),
  soldDate: z.string().optional(),
  currency: z.string().default('USD'),
  categoryId: z.string().optional(),
  categoryPath: z.string().optional(),
  condition: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  itemSpecifics: z.record(z.unknown()).optional(),
  imageUrls: z.array(z.string()).default([]),
  sellerName: z.string().optional(),
  isPrimary: z.boolean().default(false),
});

router.post('/:id/sold-comp-link', apiKeyAuth, async (req, res) => {
  const parsed = SoldCompLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const itemId = pstr(req.params.id);
  const { ebayItemId, soldDate, itemSpecifics, ...rest } = parsed.data;
  const baseData = {
    ...rest,
    soldDate: soldDate ? new Date(soldDate) : null,
    itemSpecifics: itemSpecifics as unknown as Prisma.InputJsonValue | undefined,
  };
  const link = await prisma.soldCompLink.upsert({
    where: { itemId_ebayItemId: { itemId, ebayItemId } },
    create: { itemId, ebayItemId, ...baseData },
    update: baseData,
  });

  // Backfill null Item fields from this comp.
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (item) {
    const merge: Prisma.ItemUpdateInput = {};
    if (!item.category && parsed.data.categoryPath) merge.category = parsed.data.categoryPath;
    if (!item.ebayCategoryId && parsed.data.categoryId) merge.ebayCategoryId = parsed.data.categoryId;
    if (!item.condition && parsed.data.condition) merge.condition = parsed.data.condition;
    if (!item.description && parsed.data.description) merge.description = parsed.data.description;
    if (
      item.itemSpecifics === null &&
      parsed.data.itemSpecifics &&
      Object.keys(parsed.data.itemSpecifics).length > 0
    ) {
      merge.itemSpecifics = parsed.data.itemSpecifics as unknown as Prisma.InputJsonValue;
    }
    if (Object.keys(merge).length > 0) {
      await prisma.item.update({ where: { id: itemId }, data: merge });
    }
  }

  res.json({ ok: true, link });
});

// ── Merge + photo move ────────────────────────────────────────────────

router.post('/:id/merge-into', jwtAuth, async (req, res) => {
  const sourceId = pstr(req.params.id);
  const targetId = (req.body as { targetId?: string } | undefined)?.targetId;
  if (!targetId || typeof targetId !== 'string') {
    res.status(400).json({ error: 'targetId required' });
    return;
  }
  if (targetId === sourceId) {
    res.status(400).json({ error: 'Cannot merge item into itself' });
    return;
  }
  const [source, target] = await Promise.all([
    prisma.item.findUnique({ where: { id: sourceId } }),
    prisma.item.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  const merged = await prisma.$transaction(async (tx) => {
    await tx.photo.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } });
    await tx.photoGroup.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } });
    await tx.soldCompLink.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } });
    await tx.ebayDraft.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } });
    await tx.ingestEvent.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } });
    await tx.item.update({
      where: { id: targetId },
      data: { aiCost: { increment: Number(source.aiCost) } },
    });
    await tx.item.delete({ where: { id: sourceId } });
    const updated = await tx.item.findUnique({
      where: { id: targetId },
      include: { photos: { select: { id: true } } },
    });
    return updated!;
  });

  const report = computeCompleteness({ ...merged, hasPhotos: merged.photos.length > 0 });
  await prisma.item.update({
    where: { id: targetId },
    data: { completeness: report as unknown as Prisma.InputJsonValue },
  });
  res.json({ ok: true, mergedInto: targetId });
});

const MovePhotosSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  targetItemId: z.string().min(1),
});

router.post('/:id/photos/move', jwtAuth, async (req, res) => {
  const sourceId = pstr(req.params.id);
  const parsed = MovePhotosSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const { photoIds, targetItemId } = parsed.data;
  if (targetItemId === sourceId) {
    res.status(400).json({ error: 'Source and target are the same item' });
    return;
  }
  const target = await prisma.item.findUnique({ where: { id: targetItemId } });
  if (!target) {
    res.status(404).json({ error: 'Target item not found' });
    return;
  }
  const moved = await prisma.photo.updateMany({
    where: { id: { in: photoIds }, itemId: sourceId },
    data: { itemId: targetItemId, isPrimary: false },
  });

  // Recompute completeness for both items (source may be photoless now).
  for (const id of [sourceId, targetItemId]) {
    const item = await prisma.item.findUnique({
      where: { id },
      include: { photos: { select: { id: true } } },
    });
    if (!item) continue;
    const report = computeCompleteness({ ...item, hasPhotos: item.photos.length > 0 });
    await prisma.item.update({
      where: { id },
      data: { completeness: report as unknown as Prisma.InputJsonValue },
    });
  }
  res.json({ ok: true, moved: moved.count });
});

// ── Drafts for an item ────────────────────────────────────────────────

router.get('/:id/drafts', apiKeyOrJwt, async (req, res) => {
  const drafts = await prisma.ebayDraft.findMany({
    where: { itemId: pstr(req.params.id) },
    orderBy: { lastSeenAt: 'desc' },
  });
  res.json(drafts);
});

const CreateDraftSchema = z.object({
  ebayDraftId: z.string().optional(),
  ebayDraftUrl: z.string().min(1),
  accountHint: z.string().optional(),
  currentValues: z.record(z.unknown()).optional(),
});

router.post('/:id/drafts', apiKeyAuth, async (req, res) => {
  const parsed = CreateDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const itemId = pstr(req.params.id);
  const cv = parsed.data.currentValues as unknown as Prisma.InputJsonValue | undefined;
  const draft = await prisma.ebayDraft.upsert({
    where: parsed.data.ebayDraftId
      ? { ebayDraftId: parsed.data.ebayDraftId }
      : { id: '__never__' },
    create: {
      itemId,
      ebayDraftId: parsed.data.ebayDraftId ?? null,
      ebayDraftUrl: parsed.data.ebayDraftUrl,
      accountHint: parsed.data.accountHint ?? null,
      currentValues: cv,
    },
    update: {
      itemId,
      ebayDraftUrl: parsed.data.ebayDraftUrl,
      accountHint: parsed.data.accountHint ?? null,
      currentValues: cv,
      lastSeenAt: new Date(),
    },
  });
  await prisma.item.update({
    where: { id: itemId },
    data: { stage: 'DRAFT_STARTED' },
  });
  res.status(201).json(draft);
});

export default router;
