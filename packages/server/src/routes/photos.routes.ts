// Photo-level actions that aren't scoped to an Item or Group.
//
//   DELETE /:id   hard-delete a photo row + best-effort remove its files.
//                 Works whether the photo is in the pool, in a group, or
//                 attached to an Item. onDelete: SetNull on Item.photos and
//                 PhotoGroup.photos keeps referential integrity.

import { Router } from 'express';
import fs from 'node:fs/promises';
import { prisma } from '../db/prisma.js';
import { jwtAuth } from '../middleware/auth.js';
import { logger } from '../util/logger.js';
import { pstr } from '../util/req.js';

const router = Router();

async function unlinkIfPresent(p: string | null | undefined) {
  if (!p) return;
  try {
    await fs.unlink(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger.warn({ err, path: p }, 'photo file unlink failed');
  }
}

router.delete('/:id', jwtAuth, async (req, res) => {
  const id = pstr(req.params.id);
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.photo.delete({ where: { id } });
  await Promise.all([
    unlinkIfPresent(photo.optimizedPath),
    unlinkIfPresent(photo.thumbnailPath),
    // originalPath is the watcher-inbox file — leave it; user may still want it.
  ]);
  res.json({ ok: true });
});

export default router;
