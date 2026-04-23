// Sharp-based image processing. Resizes to optimized + thumbnail variants
// and returns the saved paths + dimensions/bytes/mime metadata used by Photo.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { resolveConfigPath } from '../util/paths.js';

export interface ProcessedImage {
  optimizedPath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
}

const OPTIMIZED_LONG_EDGE = 1500;
const THUMBNAIL_LONG_EDGE = 400;
const QUALITY_OPTIMIZED = 85;
const QUALITY_THUMBNAIL = 70;

export async function processImage(
  sourcePath: string,
  outputBase: string, // e.g. "<uploads>/<groupSlug>"
  outputName: string, // e.g. "image1"
): Promise<ProcessedImage> {
  fs.mkdirSync(outputBase, { recursive: true });
  const optimizedPath = path.join(outputBase, `${outputName}.jpg`);
  const thumbnailPath = path.join(outputBase, `${outputName}.thumb.jpg`);

  const meta = await sharp(sourcePath).metadata();

  await sharp(sourcePath)
    .rotate() // honor EXIF orientation
    .resize(OPTIMIZED_LONG_EDGE, OPTIMIZED_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY_OPTIMIZED, mozjpeg: true })
    .toFile(optimizedPath);

  await sharp(sourcePath)
    .rotate()
    .resize(THUMBNAIL_LONG_EDGE, THUMBNAIL_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY_THUMBNAIL })
    .toFile(thumbnailPath);

  const stat = fs.statSync(optimizedPath);

  return {
    optimizedPath,
    thumbnailPath,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: stat.size,
    mime: 'image/jpeg',
  };
}

/** Where a photo's working files live before it has an Item-derived slug. */
export function pendingGroupDir(groupId: string): string {
  return path.join(resolveConfigPath(env.UPLOADS_DIR), `pending-${groupId}`);
}

/** Where a photo's files live once its Item is identified and named. */
export function itemGroupDir(slug: string): string {
  return path.join(resolveConfigPath(env.UPLOADS_DIR), slug);
}
