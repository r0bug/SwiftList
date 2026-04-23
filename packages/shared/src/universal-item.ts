// Mirrors comptool/UNIVERSAL-ITEM-SCHEMA.md so swiftlist can interop with
// comptool and listflow over the shared `POST /api/items/import` contract.
// swiftlist registers `sourceSystem: "swiftlist"`.

export interface UniversalItem {
  // Identity
  id: string;
  sku?: string;
  slug?: string;
  sourceSystem: 'comptool' | 'listflow' | 'yakcat' | 'swiftlist' | 'extension';
  sourceId?: string;
  sourceUrl?: string;
  clientId?: string;

  // Core
  title: string;
  description?: string;
  brand?: string;
  model?: string;
  category?: string;
  categoryId?: string;
  condition?: string;
  conditionId?: number;
  features?: string[];
  keywords?: string[];
  itemSpecifics?: ItemSpecific[];

  // Product identifiers
  upc?: string;
  isbn?: string;
  ean?: string;
  mpn?: string;
  epid?: string;

  // Pricing
  price?: number;
  startingPrice?: number;
  buyNowPrice?: number;
  soldPrice?: number;
  shippingPrice?: number;
  totalPrice?: number;
  currency?: string;

  // Pricing research
  compStats?: CompStats;

  // Listing config
  listingFormat?: 'FixedPrice' | 'Auction' | 'AuctionWithBIN';
  listingDuration?: 'GTC' | 'Days_3' | 'Days_5' | 'Days_7' | 'Days_10' | 'Days_30';
  quantity?: number;
  bidCount?: number;
  watchCount?: number;

  // Shipping
  shippingService?: string;
  shippingType?: 'Flat' | 'Calculated' | 'Free';
  weight?: number; // ounces
  packageDimensions?: PackageDimensions;
  handlingTime?: number;
  shippingProfileId?: string;
  postalCode?: string;

  // Returns
  returnPolicy?: ReturnPolicy;
  returnProfileId?: string;

  // Images
  images?: ItemImage[];
  primaryImageUrl?: string;
  localImagePath?: string;

  // Seller / source
  seller?: string;
  sellerFeedback?: number;

  // eBay
  ebayItemId?: string;
  ebayListingUrl?: string;
  ebayAccountId?: string;
  ebaySiteId?: string;

  // Workflow
  status: string;
  stage?: string;
  publishedAt?: Date | string;
  soldDate?: Date | string;
  listedAt?: Date | string;
  endedAt?: Date | string;

  // Timestamps
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ItemImage {
  url: string;
  localPath?: string;
  key?: string;
  order: number;
  altText?: string;
  thumbnailUrl?: string;
  variants?: Record<string, string>;
}

export interface ItemSpecific {
  name: string;
  value: string;
  required?: boolean;
}

export interface PackageDimensions {
  length: number; // inches
  width: number;
  height: number;
}

export interface ReturnPolicy {
  returnsAccepted: boolean;
  returnPeriod?: 'Days_14' | 'Days_30' | 'Days_60';
  refundType?: 'MoneyBack' | 'Exchange';
  shippingCostPaidBy?: 'Buyer' | 'Seller';
}

export interface CompStats {
  avg: number;
  median: number;
  min: number;
  max: number;
  p25?: number;
  p75?: number;
  count: number;
  searchKeyword: string;
  lastSoldDate?: Date | string;
}

// eBay condition ID lookup (canonical mapping from UNIVERSAL-ITEM-SCHEMA.md)
export const EBAY_CONDITION_ID: Record<string, number> = {
  New: 1000,
  'New Other': 1500,
  'New with Defects': 1750,
  Remanufactured: 2000,
  'Certified Refurbished': 2500,
  'Like New': 3000,
  'Very Good': 4000,
  Good: 5000,
  Acceptable: 6000,
  'For Parts': 7000,
};
