// Perceptual hash via blockhash-core. Used to cluster near-duplicate or
// same-item-different-angle photos before paying for an LLM call.

import sharp from 'sharp';
import { bmvbhash } from 'blockhash-core';

const HASH_BITS = 16; // 16x16 = 256-bit hash, hex-encoded as 64 chars

export async function perceptualHash(filePath: string): Promise<string> {
  const { data, info } = await sharp(filePath)
    .resize(256, 256, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const imageData = {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
  return bmvbhash(imageData, HASH_BITS);
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  // Hex compare nibble-by-nibble.
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i]!, 16);
    const xb = parseInt(b[i]!, 16);
    let xor = xa ^ xb;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}
