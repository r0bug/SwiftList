// EbayAutofillPayload is the contract between the swiftlist server and the
// Chrome extension. The extension's content-listing.js / content-draft.js
// consume this shape and write it into eBay's listing-form fields.
//
// Selector strategy in the extension is documented in the plan; this type
// is the source of truth for *what* gets filled, not *how*.

export interface EbayAutofillPayload {
  itemId: string;
  draftId?: string; // present when the payload is targeting a known EbayDraft

  title: string; // ≤ 80 chars (eBay limit)
  subtitle?: string;

  category: { id: string; path: string };
  storeCategory?: { id: string; name: string };

  condition: {
    id: number; // EBAY_CONDITION_ID
    label: string;
    description?: string;
  };

  itemSpecifics: Array<{ name: string; values: string[] }>;

  description: { html: string; plain?: string };

  photos: Array<{ url: string; isPrimary: boolean; order: number }>;

  pricing: {
    format: 'FixedPrice' | 'Auction';
    buyNowPrice?: number;
    startingPrice?: number;
    bestOffer?: { enabled: boolean; autoAccept?: number; autoDecline?: number };
    duration: 'GTC' | 'Days_3' | 'Days_5' | 'Days_7' | 'Days_10';
  };

  shipping: {
    weightOz?: number;
    packageDimensions?: { lengthIn: number; widthIn: number; heightIn: number };
    services: Array<{ id: string; cost: number }>;
    handlingDays?: number;
    postalCode?: string;
  };

  returnPolicy?: {
    accepted: boolean;
    periodDays?: number;
    whoPays?: 'Buyer' | 'Seller';
  };

  productIdentifiers?: {
    upc?: string;
    isbn?: string;
    mpn?: string;
    epid?: string;
    brand?: string;
  };

  metadata: {
    swiftlistVersion: string;
    sourceSystem: 'swiftlist';
    generatedAt: string; // ISO-8601
  };
}

// All field names the autofill / draft system knows about. Used by
// EbayDraft.lastFilledFields and currentValues to track per-field state.
export const AUTOFILL_FIELD_NAMES = [
  'title',
  'subtitle',
  'category',
  'storeCategory',
  'condition',
  'itemSpecifics',
  'description',
  'photos',
  'pricing.format',
  'pricing.buyNowPrice',
  'pricing.startingPrice',
  'pricing.bestOffer',
  'pricing.duration',
  'shipping.weightOz',
  'shipping.packageDimensions',
  'shipping.services',
  'shipping.handlingDays',
  'shipping.postalCode',
  'returnPolicy',
  'productIdentifiers.upc',
  'productIdentifiers.isbn',
  'productIdentifiers.mpn',
  'productIdentifiers.epid',
  'productIdentifiers.brand',
] as const;

export type AutofillFieldName = (typeof AUTOFILL_FIELD_NAMES)[number];
