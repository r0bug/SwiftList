// Deterministic pre-LLM grouping. Cheap union-find over (folder × filename
// × timestamp × perceptual hash). Produces candidate PhotoGroups that the
// AI service then confirms / splits / merges.

import { hammingDistance } from '../util/perceptualHash.js';

export interface PhotoCandidate {
  id: string; // Photo.id (already persisted with sha256)
  sourceFolder: string;
  filename: string;
  filenameNumeric: number | null;
  capturedAt: Date | null;
  perceptualHash: string | null;
}

export interface ClusterResult {
  clusters: PhotoCandidate[][]; // each inner array is one candidate group
}

const FILENAME_GAP = 5;
const TIMESTAMP_GAP_MS = 60_000;
const PHASH_HAMMING_MAX = 10;

export function clusterPhotos(photos: PhotoCandidate[]): ClusterResult {
  const n = photos.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areRelated(photos[i]!, photos[j]!)) union(i, j);
    }
  }

  const groups = new Map<number, PhotoCandidate[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(photos[i]!);
  }

  return { clusters: [...groups.values()] };
}

function areRelated(a: PhotoCandidate, b: PhotoCandidate): boolean {
  // Different folder → never grouped automatically.
  if (a.sourceFolder !== b.sourceFolder) return false;

  // Strong signal: consecutive filename numeric.
  if (
    a.filenameNumeric !== null &&
    b.filenameNumeric !== null &&
    Math.abs(a.filenameNumeric - b.filenameNumeric) <= FILENAME_GAP
  ) {
    return true;
  }

  // Strong signal: tight capture timestamp.
  if (
    a.capturedAt &&
    b.capturedAt &&
    Math.abs(a.capturedAt.getTime() - b.capturedAt.getTime()) <= TIMESTAMP_GAP_MS
  ) {
    return true;
  }

  // Visual similarity.
  if (a.perceptualHash && b.perceptualHash) {
    const d = hammingDistance(a.perceptualHash, b.perceptualHash);
    if (d <= PHASH_HAMMING_MAX) return true;
  }

  return false;
}
