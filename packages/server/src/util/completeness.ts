// Pure function: given an Item-shaped object, compute a completeness score.
// Mirrors listflow's 7-point check pattern, expanded for swiftlist's flow.

import type { Item } from '../generated/prisma/index.js';

interface ItemForCompleteness extends Pick<
  Item,
  | 'title'
  | 'description'
  | 'category'
  | 'ebayCategoryId'
  | 'condition'
  | 'startingPrice'
  | 'buyNowPrice'
  | 'shippingPrice'
  | 'weightOz'
  | 'itemSpecifics'
> {
  hasPhotos: boolean;
}

export interface CompletenessReport {
  score: number; // 0–100
  missing: string[];
  checks: Record<string, boolean>;
}

export function computeCompleteness(item: ItemForCompleteness): CompletenessReport {
  const checks: Record<string, boolean> = {
    hasPhotos: item.hasPhotos,
    hasTitle: !!item.title?.trim(),
    hasDescription: !!item.description?.trim(),
    hasCategory: !!item.ebayCategoryId || !!item.category?.trim(),
    hasCondition: !!item.condition?.trim(),
    hasPrice: item.startingPrice !== null || item.buyNowPrice !== null,
    hasShipping: item.shippingPrice !== null || item.weightOz !== null,
    hasSpecifics:
      !!item.itemSpecifics &&
      typeof item.itemSpecifics === 'object' &&
      Object.keys(item.itemSpecifics).length > 0,
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = Math.round((passed / total) * 100);
  const missing = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return { score, missing, checks };
}
