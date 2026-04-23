// Manual photo-grouping. A PhotoGroup with itemId=null and status=PENDING is
// an "unidentified" folder the user created by selecting photos in the pool.
// Identification actions (AI analyze, eBay image-search match) are wired in a
// later PR; this router only covers the group's lifecycle:
//
//   POST   /            create group from photoIds (+ auto label)
//   GET    /            list groups (default: unidentified only)
//   GET    /:id         detail with photos
//   POST   /:id/photos  add more photos from the pool
//   DELETE /:id/photos/:photoId   remove photo from group (back to pool)
//   DELETE /:id         dissolve group (all photos back to pool; Item untouched)

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { jwtAuth } from '../middleware/auth.js';
import { qstr, pstr } from '../util/req.js';

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

export default router;
