// Types for the eBay draft-resume flow. The extension snapshots the live
// in-page form values as `DraftCurrentValues`, the server diffs that against
// the source Item to produce a `DraftDeltaPayload` (only fields that are
// missing or stale AND haven't been user-edited since the last fill).

import type { EbayAutofillPayload, AutofillFieldName } from './autofill.js';

export type DraftStatus = 'OPEN' | 'SUBMITTED' | 'ABANDONED' | 'UNKNOWN';

export interface EbayDraftRecord {
  id: string;
  itemId: string;
  ebayDraftId: string | null;
  ebayDraftUrl: string;
  accountHint: string | null;
  lastSeenAt: string;
  lastFilledAt: string | null;
  lastFilledFields: AutofillFieldName[] | null;
  currentValues: DraftCurrentValues | null;
  status: DraftStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// What the extension reports back from the live form. Loose shape — extension
// fills only what it can read; missing fields mean "not visible / not set".
export interface DraftCurrentValues {
  title?: string;
  subtitle?: string;
  category?: { id?: string; path?: string };
  storeCategory?: { id?: string; name?: string };
  condition?: { id?: number; label?: string };
  itemSpecifics?: Record<string, string[]>;
  description?: { html?: string; plain?: string };
  photoCount?: number; // we don't try to round-trip image URLs from the form
  pricing?: {
    format?: 'FixedPrice' | 'Auction';
    buyNowPrice?: number;
    startingPrice?: number;
    duration?: string;
  };
  shipping?: {
    weightOz?: number;
    packageDimensions?: { lengthIn?: number; widthIn?: number; heightIn?: number };
    handlingDays?: number;
    postalCode?: string;
  };
  productIdentifiers?: {
    upc?: string;
    isbn?: string;
    mpn?: string;
    epid?: string;
    brand?: string;
  };
}

// The "fill missing" response. Same shape as EbayAutofillPayload but every
// section is partial. Extension applies only the fields present here.
export type DraftDeltaPayload = DeepPartial<EbayAutofillPayload> & {
  itemId: string;
  draftId: string;
  /** Field names the server decided to fill in this delta. */
  fieldsToFill: AutofillFieldName[];
  /** Field names the server skipped (with reason for telemetry / UI). */
  skipped: Array<{ name: AutofillFieldName; reason: 'item-empty' | 'already-set' | 'user-edited' }>;
};

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// Request body for POST /api/v1/items/:id/drafts (extension creates / re-syncs
// the link between an eBay draft and a swiftlist Item).
export interface DraftLinkRequest {
  ebayDraftId?: string;
  ebayDraftUrl: string;
  accountHint?: string;
  currentValues?: DraftCurrentValues;
}

// Request body for PATCH /api/v1/drafts/:id (extension heartbeat).
export interface DraftPatchRequest {
  currentValues?: DraftCurrentValues;
  lastFilledFields?: AutofillFieldName[];
  status?: DraftStatus;
  ebayItemId?: string; // set by content-draft.js when it observes submission
}
