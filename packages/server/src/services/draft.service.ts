// Owns the eBay draft-resume math.
//
//   buildAutofillPayload(itemId)        → full payload (used by /autofill and force-overwrite)
//   buildDeltaPayload(draftId)          → only fields that should still be filled
//
// Resume rule for each field name F:
//   fill(F) ⟺ ItemHasValue(F)
//          ∧ DraftCurrentValue(F) ≠ ItemValue(F)
//          ∧ (F ∉ EbayDraft.lastFilledFields  OR  draft value ≠ what we last wrote)
//
// The "user-edited since last fill" signal: if we previously wrote field F
// and the live draft now shows a different value, the user changed it — skip.

import { prisma } from '../db/prisma.js';
import { resolvePhotoUrl } from './imageHosting.service.js';
import {
  AUTOFILL_FIELD_NAMES,
  type AutofillFieldName,
  type EbayAutofillPayload,
} from '@swiftlist/shared';
import type { DraftCurrentValues, DraftDeltaPayload } from '@swiftlist/shared';
import { EBAY_CONDITION_ID } from '@swiftlist/shared';
import { readFileSync } from 'node:fs';

const PACKAGE_VERSION = readPkgVersion();

export async function buildAutofillPayload(
  itemId: string,
  draftId?: string,
): Promise<EbayAutofillPayload> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { photos: { orderBy: { order: 'asc' } } },
  });
  if (!item) throw new Error('Item not found');

  const itemSpecifics: Array<{ name: string; values: string[] }> = [];
  if (item.itemSpecifics && typeof item.itemSpecifics === 'object') {
    for (const [name, raw] of Object.entries(item.itemSpecifics as Record<string, unknown>)) {
      const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      itemSpecifics.push({ name, values });
    }
  }

  const conditionLabel = item.condition || 'Used';
  const conditionId =
    item.conditionId ??
    EBAY_CONDITION_ID[conditionLabel] ??
    EBAY_CONDITION_ID['Used'] ??
    3000;

  const photos = item.photos
    .map((p) => ({
      url: resolvePhotoUrl(p),
      isPrimary: p.isPrimary,
      order: p.order,
    }))
    .filter((p): p is { url: string; isPrimary: boolean; order: number } => !!p.url);

  const dims =
    item.packageDimensions && typeof item.packageDimensions === 'object'
      ? (item.packageDimensions as { length?: number; width?: number; height?: number })
      : null;

  return {
    itemId: item.id,
    draftId,
    title: (item.title || '').slice(0, 80),
    category: { id: item.ebayCategoryId || '', path: item.category || '' },
    condition: { id: conditionId, label: conditionLabel },
    itemSpecifics,
    description: { html: item.description || '' },
    photos,
    pricing: {
      format: (item.listingFormat as 'FixedPrice' | 'Auction') || 'FixedPrice',
      buyNowPrice: item.buyNowPrice ? Number(item.buyNowPrice) : undefined,
      startingPrice: item.startingPrice ? Number(item.startingPrice) : undefined,
      duration:
        (item.listingDuration as 'GTC' | 'Days_3' | 'Days_5' | 'Days_7' | 'Days_10') || 'GTC',
    },
    shipping: {
      weightOz: item.weightOz ?? undefined,
      packageDimensions: dims
        ? {
            lengthIn: dims.length ?? 0,
            widthIn: dims.width ?? 0,
            heightIn: dims.height ?? 0,
          }
        : undefined,
      services: [],
      handlingDays: undefined,
      postalCode: item.postalCode ?? undefined,
    },
    productIdentifiers: {
      upc: item.upc ?? undefined,
      isbn: item.isbn ?? undefined,
      mpn: item.mpn ?? undefined,
      epid: item.epid ?? undefined,
      brand: item.brand ?? undefined,
    },
    metadata: {
      swiftlistVersion: PACKAGE_VERSION,
      sourceSystem: 'swiftlist',
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function buildDeltaPayload(draftId: string): Promise<DraftDeltaPayload> {
  const draft = await prisma.ebayDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error('Draft not found');

  const full = await buildAutofillPayload(draft.itemId, draft.id);
  const live = (draft.currentValues as DraftCurrentValues | null) ?? {};
  const previouslyFilled = new Set<AutofillFieldName>(
    (draft.lastFilledFields as AutofillFieldName[] | null) ?? [],
  );

  const fieldsToFill: AutofillFieldName[] = [];
  const skipped: DraftDeltaPayload['skipped'] = [];
  const delta: Partial<EbayAutofillPayload> = {};

  for (const fieldName of AUTOFILL_FIELD_NAMES) {
    const itemValue = readField(full, fieldName);
    const liveValue = readDraftField(live, fieldName);

    if (isEmpty(itemValue)) {
      skipped.push({ name: fieldName, reason: 'item-empty' });
      continue;
    }

    // If user edited this field after we last filled it, leave it alone.
    if (previouslyFilled.has(fieldName) && !isEmpty(liveValue) && !valuesMatch(itemValue, liveValue)) {
      skipped.push({ name: fieldName, reason: 'user-edited' });
      continue;
    }

    if (!isEmpty(liveValue) && valuesMatch(itemValue, liveValue)) {
      skipped.push({ name: fieldName, reason: 'already-set' });
      continue;
    }

    writeField(delta, fieldName, itemValue);
    fieldsToFill.push(fieldName);
  }

  return {
    ...(delta as DraftDeltaPayload),
    itemId: draft.itemId,
    draftId: draft.id,
    fieldsToFill,
    skipped,
  };
}

// ── Field-name path helpers ─────────────────────────────────────────────

function readField(payload: EbayAutofillPayload, name: AutofillFieldName): unknown {
  return getByPath(payload as unknown as Record<string, unknown>, name);
}

function readDraftField(live: DraftCurrentValues, name: AutofillFieldName): unknown {
  return getByPath(live as unknown as Record<string, unknown>, name);
}

function writeField(target: Partial<EbayAutofillPayload>, name: AutofillFieldName, value: unknown): void {
  setByPath(target as unknown as Record<string, unknown>, name, value);
}

function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (!cursor[k] || typeof cursor[k] !== 'object') cursor[k] = {};
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.01;
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  // For objects/arrays: stringify is good enough for the autofill payload shape.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function readPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
