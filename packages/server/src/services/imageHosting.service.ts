// Adapted from listflow/src/services/imageHosting.service.ts.
// Copies optimized photos into a public per-item folder and writes the URL
// back onto Photo.publicUrl. With cloud DB + local server, these URLs resolve
// to the user's local machine — by design.

import fs from 'node:fs';
import path from 'node:path';
import slugify from 'slugify';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

export interface HostedPhoto {
  photoId: string;
  publicUrl: string;
}

export function makeSlug(title: string | null | undefined, idSuffix: string): string {
  const base = slugify(title || 'item', { lower: true, strict: true }).slice(0, 60);
  return `${base || 'item'}-${idSuffix}`;
}

export async function hostItemImages(itemId: string): Promise<HostedPhoto[]> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: { orderBy: { order: 'asc' } } },
  });
  if (!item) throw new Error('Item not found');
  if (item.photos.length === 0) return [];

  const slug = makeSlug(item.title, item.id.slice(-8));
  const destDir = path.resolve(env.PUBLIC_IMAGES_DIR, 'swiftlist', slug);
  fs.mkdirSync(destDir, { recursive: true });

  const out: HostedPhoto[] = [];
  for (let i = 0; i < item.photos.length; i++) {
    const photo = item.photos[i]!;
    const sourcePath = photo.optimizedPath || photo.originalPath;
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;

    const ext = path.extname(sourcePath) || '.jpg';
    const filename = `image${i + 1}${ext}`;
    const destPath = path.join(destDir, filename);
    fs.copyFileSync(sourcePath, destPath);

    const publicUrl = `${env.PUBLIC_IMAGE_BASE_URL}/public-images/swiftlist/${slug}/${filename}`;
    await prisma.photo.update({ where: { id: photo.id }, data: { publicUrl } });
    out.push({ photoId: photo.id, publicUrl });
  }
  return out;
}

/** URL the autofill payload should advertise. cdnUrl wins when configured. */
export function resolvePhotoUrl(p: { cdnUrl: string | null; publicUrl: string | null }): string | null {
  return p.cdnUrl ?? p.publicUrl ?? null;
}
