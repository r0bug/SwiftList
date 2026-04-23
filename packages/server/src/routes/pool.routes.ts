// Pool = photos ingested but not yet assigned to an Item.
// Returns a cursor-paginated list, latest first.

import { Router } from 'express';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { jwtAuth } from '../middleware/auth.js';
import { qstr } from '../util/req.js';

const router = Router();

router.get('/', jwtAuth, async (req, res) => {
  const cursor = qstr(req.query.cursor);
  const take = Math.min(Number(qstr(req.query.limit)) || 50, 200);

  const photos = await prisma.photo.findMany({
    where: { itemId: null },
    select: {
      id: true,
      thumbnailPath: true,
      publicUrl: true,
      cdnUrl: true,
      originalPath: true,
      createdAt: true,
      photoGroupId: true,
    },
    take: take + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    orderBy: { createdAt: 'desc' },
  });

  const nextCursor = photos.length > take ? photos.pop()?.id ?? null : null;

  // Count total un-assigned for header display.
  const total = await prisma.photo.count({ where: { itemId: null } });

  res.json({
    photos: photos.map((p) => ({
      id: p.id,
      thumbnailPath: p.thumbnailPath,
      publicUrl: p.publicUrl,
      cdnUrl: p.cdnUrl,
      originalPath: p.originalPath ? path.basename(p.originalPath) : null,
      createdAt: p.createdAt,
      photoGroupId: p.photoGroupId,
    })),
    nextCursor,
    total,
  });
});

export default router;
