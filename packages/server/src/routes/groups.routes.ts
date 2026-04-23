// Manual photo-grouping + identification.
// A PhotoGroup with itemId=null and status=PENDING is an "unidentified" folder
// the user created by selecting photos in the pool. Identification runs the
// user explicitly triggers from /groups/:id in the web UI:
//
//   POST   /            create group from photoIds (+ auto label)
//   GET    /            list groups (default: unidentified only)
//   GET    /:id         detail with photos
//   POST   /:id/photos  add more photos from the pool
//   DELETE /:id/photos/:photoId   remove photo from group (back to pool)
//   DELETE /:id         dissolve group (all photos back to pool; Item untouched)
//   POST   /:id/identify-ai     run LLM identification (anthropic|external-mcp)
//   POST   /:id/identify-ebay   attach eBay comp as identification (approval panel)

import { Router } from 'express';
import fs from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/index.js';
import { prisma } from '../db/prisma.js';
import { jwtAuth } from '../middleware/auth.js';
import { qstr, pstr } from '../util/req.js';
import { logger } from '../util/logger.js';
import { aiService, type PhotoForAnalysis } from '../services/ai.service.js';
import {
  searchByImage,
  ebayBrowseConfigured,
  type EbayItemSummary,
} from '../services/ebayBrowse.service.js';
import { hostItemImages } from '../services/imageHosting.service.js';
import { computeCompleteness } from '../util/completeness.js';
import { loadAiProvider } from './settings.routes.js';

const router = Router();

const CreateGroupSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  label: z.string().trim().max(120).optional(),
});

const AddPhotosSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
});

router.post('/', jwtAuth, async (req, res) => {
  const parsed = CreateGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const { photoIds, label } = parsed.data;

  const photos = await prisma.photo.findMany({
    where: { id: { in: photoIds }, itemId: null, photoGroupId: null },
    select: { id: true, originalPath: true },
  });
  if (photos.length === 0) {
    res
      .status(400)
      .json({ error: 'No eligible photos — all requested ids are missing or already grouped.' });
    return;
  }

  // Label defaults to "New-Item-N" based on current unidentified-group count.
  const defaultLabel = label?.trim() || `New-Item-${(await prisma.photoGroup.count({ where: { itemId: null } })) + 1}`;

  // sourceFolder: best-effort use the dirname of the first photo's originalPath,
  // falls back to '(manual)' so the column stays non-null.
  const sourceFolder = (() => {
    const first = photos[0]?.originalPath ?? '';
    if (!first) return '(manual)';
    const slash = first.lastIndexOf('/');
    return slash >= 0 ? first.slice(0, slash) : '(manual)';
  })();

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.photoGroup.create({
      data: { label: defaultLabel, sourceFolder, status: 'PENDING' },
    });
    await tx.photo.updateMany({
      where: { id: { in: photos.map((p) => p.id) } },
      data: { photoGroupId: created.id },
    });
    return created;
  });

  res.status(201).json({ id: group.id, label: group.label, photoCount: photos.length });
});

router.get('/', jwtAuth, async (req, res) => {
  const unidentifiedOnly = qstr(req.query.unidentified) !== 'false';

  const groups = await prisma.photoGroup.findMany({
    where: unidentifiedOnly ? { itemId: null } : undefined,
    include: {
      photos: {
        take: 1,
        orderBy: { createdAt: 'asc' },
        select: { id: true, thumbnailPath: true, publicUrl: true, cdnUrl: true },
      },
      _count: { select: { photos: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    groups: groups.map((g) => ({
      id: g.id,
      label: g.label,
      itemId: g.itemId,
      status: g.status,
      createdAt: g.createdAt,
      photoCount: g._count.photos,
      coverPhoto: g.photos[0] ?? null,
    })),
  });
});

router.get('/:id', jwtAuth, async (req, res) => {
  const group = await prisma.photoGroup.findUnique({
    where: { id: pstr(req.params.id) },
    include: {
      photos: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          thumbnailPath: true,
          publicUrl: true,
          cdnUrl: true,
          originalPath: true,
          createdAt: true,
        },
      },
      item: { select: { id: true, title: true, status: true, stage: true } },
    },
  });
  if (!group) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({
    id: group.id,
    label: group.label,
    itemId: group.itemId,
    status: group.status,
    createdAt: group.createdAt,
    item: group.item,
    photos: group.photos,
  });
});

router.post('/:id/photos', jwtAuth, async (req, res) => {
  const parsed = AddPhotosSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const groupId = pstr(req.params.id);
  const group = await prisma.photoGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Only take photos that are currently unattached. Never hijack from another group.
  const eligible = await prisma.photo.findMany({
    where: { id: { in: parsed.data.photoIds }, itemId: null, photoGroupId: null },
    select: { id: true },
  });
  if (eligible.length === 0) {
    res.json({ ok: true, added: 0 });
    return;
  }
  await prisma.photo.updateMany({
    where: { id: { in: eligible.map((p) => p.id) } },
    data: { photoGroupId: groupId, itemId: group.itemId },
  });
  res.json({ ok: true, added: eligible.length });
});

router.delete('/:id/photos/:photoId', jwtAuth, async (req, res) => {
  const groupId = pstr(req.params.id);
  const photoId = pstr(req.params.photoId);
  await prisma.photo.updateMany({
    where: { id: photoId, photoGroupId: groupId },
    data: { photoGroupId: null, itemId: null },
  });
  res.json({ ok: true });
});

router.delete('/:id', jwtAuth, async (req, res) => {
  const groupId = pstr(req.params.id);
  const group = await prisma.photoGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.photo.updateMany({
      where: { photoGroupId: groupId },
      data: { photoGroupId: null, itemId: null },
    });
    await tx.photoGroup.delete({ where: { id: groupId } });
  });
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// Identification: AI
// ────────────────────────────────────────────────────────────────────

const IdentifyAiSchema = z.object({
  context: z.string().max(2000).optional(),
  useVisualPriors: z.boolean().optional().default(true),
});

async function fetchVisualPriors(photoPath: string) {
  if (!ebayBrowseConfigured()) return [];
  try {
    const buf = await sharp(photoPath)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const resp = await searchByImage(buf.toString('base64'), { limit: 5 });
    return (resp.itemSummaries ?? []).slice(0, 5).map((s) => ({
      title: s.title,
      category: s.categoryPath,
      condition: s.condition,
      itemSpecifics: undefined,
    }));
  } catch (err) {
    logger.warn({ err }, 'eBay visual priors failed; continuing without them');
    return [];
  }
}

router.post('/:id/identify-ai', jwtAuth, async (req, res) => {
  const parsed = IdentifyAiSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const groupId = pstr(req.params.id);
  const group = await prisma.photoGroup.findUnique({
    where: { id: groupId },
    include: {
      photos: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          originalPath: true,
          optimizedPath: true,
          capturedAt: true,
          perceptualHash: true,
        },
      },
    },
  });
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }
  if (group.photos.length === 0) {
    res.status(400).json({ error: 'Group has no photos' });
    return;
  }

  const provider = await loadAiProvider();

  // external-mcp path: queue a batch for a Claude Code worker to drain.
  if (provider === 'external-mcp') {
    const batch = await prisma.externalAnalysisBatch.create({
      data: {
        sourceFolder: group.sourceFolder,
        status: 'QUEUED',
        photoIds: group.photos.map((p) => p.id),
        continuation: {
          groupId,
          context: parsed.data.context?.trim() || undefined,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    res.json({ queued: true, batchId: batch.id, provider });
    return;
  }

  // Build PhotoForAnalysis[] from the group's photos in chronological order.
  const photosForAi: PhotoForAnalysis[] = group.photos.map((p, i) => ({
    index: i + 1,
    filePath: p.optimizedPath || p.originalPath,
    filename: p.originalPath.split('/').pop() ?? `photo-${i + 1}`,
    capturedAt: p.capturedAt,
    perceptualHash: p.perceptualHash,
  }));

  // Optional eBay Browse priors from the first photo.
  const visualMatches = parsed.data.useVisualPriors
    ? await fetchVisualPriors(photosForAi[0]!.filePath)
    : [];

  const { result, costUsd } = await aiService.analyze({
    photos: photosForAi,
    context: parsed.data.context?.trim() || undefined,
    visualMatches,
  });

  // Trust the user's grouping: take the first AI-returned group. If Claude
  // splits into multiples, we still only promote the first here — the user
  // can manually split afterward via move-selected.
  const first = result.groups[0];
  if (!first) {
    res.status(502).json({ error: 'AI returned no groups' });
    return;
  }
  const draft = first.item;

  const itemId = await prisma.$transaction(async (tx) => {
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
        status: 'IN_PROCESS',
        stage: 'IDENTIFIED',
        sourceFolder: group.sourceFolder,
        aiAnalysis: first as unknown as Prisma.InputJsonValue,
        aiCost: costUsd,
      },
    });
    await tx.photoGroup.update({
      where: { id: groupId },
      data: { itemId: newItem.id, status: 'ASSIGNED', label: newItem.title },
    });
    await tx.photo.updateMany({
      where: { photoGroupId: groupId },
      data: { itemId: newItem.id },
    });
    for (const p of group.photos) {
      await tx.ingestEvent.create({
        data: {
          path: '',
          sha256: '',
          decision: 'NEW_ITEM',
          itemId: newItem.id,
          groupId,
          llmCostUsd: costUsd,
        },
      });
    }
    return newItem.id;
  });

  // Host images + recompute completeness (best-effort, outside transaction).
  hostItemImages(itemId).catch((err) =>
    logger.warn({ err, itemId }, 'hostItemImages failed'),
  );
  const created = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: { select: { id: true } } },
  });
  if (created) {
    const report = computeCompleteness({ ...created, hasPhotos: created.photos.length > 0 });
    await prisma.item.update({
      where: { id: itemId },
      data: { completeness: report as unknown as Prisma.InputJsonValue },
    });
  }

  res.json({ queued: false, itemId, costUsd, provider });
});

// ────────────────────────────────────────────────────────────────────
// Identification: eBay comp match (user picked a result from image search)
// ────────────────────────────────────────────────────────────────────

// Only `title` is required; everything else is gated by `approvedFields`
// which is the checkbox state from the approval panel. Images default OFF.
const EbayAttachSchema = z.object({
  ebayItemId: z.string().min(1),
  ebayItemUrl: z.string().url().optional(),
  hit: z.object({
    title: z.string(),
    condition: z.string().optional(),
    categoryPath: z.string().optional(),
    categoryId: z.string().optional(),
    description: z.string().optional(),
    itemSpecifics: z.record(z.string()).optional(),
    imageUrls: z.array(z.string().url()).optional(),
    price: z.object({ value: z.string(), currency: z.string() }).optional(),
  }),
  approvedFields: z
    .object({
      title: z.boolean().default(true),
      description: z.boolean().default(true),
      category: z.boolean().default(true),
      condition: z.boolean().default(true),
      itemSpecifics: z.boolean().default(true),
      images: z.boolean().default(false),
    })
    .default({
      title: true,
      description: true,
      category: true,
      condition: true,
      itemSpecifics: true,
      images: false,
    }),
});

router.post('/:id/identify-ebay', jwtAuth, async (req, res) => {
  const parsed = EbayAttachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const groupId = pstr(req.params.id);
  const group = await prisma.photoGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  const { hit, approvedFields, ebayItemId, ebayItemUrl } = parsed.data;
  const title = approvedFields.title ? hit.title : '(untitled)';

  const itemId = await prisma.$transaction(async (tx) => {
    const newItem = await tx.item.create({
      data: {
        title,
        description: approvedFields.description ? hit.description ?? null : null,
        category: approvedFields.category ? hit.categoryPath ?? null : null,
        ebayCategoryId: approvedFields.category ? hit.categoryId ?? null : null,
        condition: approvedFields.condition ? hit.condition ?? null : null,
        itemSpecifics:
          approvedFields.itemSpecifics && hit.itemSpecifics
            ? (hit.itemSpecifics as unknown as Prisma.InputJsonValue)
            : undefined,
        features: [],
        keywords: [],
        status: 'IN_PROCESS',
        stage: 'IDENTIFIED',
        sourceFolder: group.sourceFolder,
        aiAnalysis: { source: 'ebay-comp', ebayItemId, hit } as unknown as Prisma.InputJsonValue,
        aiCost: 0,
      },
    });

    await tx.photoGroup.update({
      where: { id: groupId },
      data: { itemId: newItem.id, status: 'ASSIGNED', label: newItem.title },
    });
    await tx.photo.updateMany({
      where: { photoGroupId: groupId },
      data: { itemId: newItem.id },
    });

    // Provenance: record the comp link. imageUrls are saved either way so
    // the user can revisit; import-to-Item only happens on approval.
    await tx.soldCompLink.create({
      data: {
        itemId: newItem.id,
        ebayItemId,
        title: hit.title,
        condition: hit.condition,
        categoryPath: hit.categoryPath,
        categoryId: hit.categoryId,
        description: hit.description,
        itemSpecifics:
          (hit.itemSpecifics as unknown as Prisma.InputJsonValue | undefined) ?? undefined,
        imageUrls: hit.imageUrls ?? [],
        isPrimary: true,
      },
    });

    return newItem.id;
  });

  // Image import (opt-in): download approved eBay images and attach as Photos.
  if (approvedFields.images && hit.imageUrls && hit.imageUrls.length > 0) {
    await importEbayImages(itemId, hit.imageUrls).catch((err) =>
      logger.warn({ err, itemId }, 'eBay image import failed'),
    );
  }

  hostItemImages(itemId).catch((err) =>
    logger.warn({ err, itemId }, 'hostItemImages failed'),
  );
  const created = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: { select: { id: true } } },
  });
  if (created) {
    const report = computeCompleteness({ ...created, hasPhotos: created.photos.length > 0 });
    await prisma.item.update({
      where: { id: itemId },
      data: { completeness: report as unknown as Prisma.InputJsonValue },
    });
  }

  res.json({ itemId, ebayItemId, ebayItemUrl });
});

// Best-effort image downloader: grabs each eBay imageUrl, writes it into the
// uploads pending dir, computes sha256, and attaches a new Photo row to the
// item. Skips duplicates silently.
async function importEbayImages(itemId: string, urls: string[]): Promise<void> {
  const { default: path } = await import('node:path');
  const { sha256File } = await import('../util/sha256.js');
  const { processImage, pendingGroupDir } = await import('../services/image.service.js');
  const tempDir = pendingGroupDir(`ebay-${itemId.slice(-8)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const ab = await resp.arrayBuffer();
      const ext = (path.extname(new URL(url).pathname) || '.jpg').slice(0, 5);
      const tempFile = path.join(tempDir, `ebay-${i}${ext}`);
      fs.writeFileSync(tempFile, Buffer.from(ab));
      const sha256 = await sha256File(tempFile);
      const existing = await prisma.photo.findUnique({ where: { sha256 } });
      if (existing) {
        fs.unlinkSync(tempFile);
        continue;
      }
      const processed = await processImage(tempFile, tempDir, sha256.slice(0, 12));
      await prisma.photo.create({
        data: {
          itemId,
          originalPath: tempFile,
          optimizedPath: processed.optimizedPath,
          thumbnailPath: processed.thumbnailPath,
          sha256,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
          mime: processed.mime,
          publicUrl: url, // preserve source URL as a fallback
        },
      });
    } catch (err) {
      logger.warn({ err, url }, 'ebay image download failed');
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Per-photo image search from a specific group photo — used by the
// eBay-ident UI to let the user pick WHICH photo to search with. Thin
// wrapper around ebayBrowse.service.searchByImage.
// ────────────────────────────────────────────────────────────────────

router.post('/:id/image-search', jwtAuth, async (req, res) => {
  if (!ebayBrowseConfigured()) {
    res.status(503).json({ error: 'EBAY_BROWSE_CLIENT_ID / _SECRET not configured' });
    return;
  }
  const photoId = (req.body as { photoId?: string } | undefined)?.photoId;
  if (!photoId) {
    res.status(400).json({ error: 'photoId required' });
    return;
  }
  const groupId = pstr(req.params.id);
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, photoGroupId: groupId },
    select: { optimizedPath: true, originalPath: true },
  });
  if (!photo) {
    res.status(404).json({ error: 'Photo not in this group' });
    return;
  }
  const source = photo.optimizedPath || photo.originalPath;
  try {
    const buf = await sharp(source)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const limit = Math.min(
      Math.max(Number((req.body as { limit?: number } | undefined)?.limit) || 20, 1),
      50,
    );
    const data = await searchByImage(buf.toString('base64'), { limit });
    res.json({
      itemSummaries: (data.itemSummaries ?? []) as EbayItemSummary[],
      total: data.total ?? data.itemSummaries?.length ?? 0,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
