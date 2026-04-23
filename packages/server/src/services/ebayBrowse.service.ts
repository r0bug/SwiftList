// Thin wrapper around eBay's Buy → Browse API. Only what we need:
//   - application OAuth token (client_credentials) with in-memory cache
//   - POST /item_summary/search_by_image (base64 image → itemSummaries)
//
// Uses EBAY_BROWSE_CLIENT_ID / EBAY_BROWSE_CLIENT_SECRET from .env.
// NOTE: search_by_image returns ACTIVE listings, not sold ones. Sold comps
// are surfaced elsewhere (extension scrape of /sch/ URL). The matches are
// still useful: they identify the item so the UI can pivot to a sold-comps
// text search with the resolved title/keywords.

import { logger } from '../util/logger.js';

const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search_by_image';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const MARKETPLACE_ID = 'EBAY_US';

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | null = null;

function ebayClientId(): string | null {
  return process.env.EBAY_BROWSE_CLIENT_ID?.trim() || null;
}
function ebayClientSecret(): string | null {
  return process.env.EBAY_BROWSE_CLIENT_SECRET?.trim() || null;
}

export function ebayBrowseConfigured(): boolean {
  return !!(ebayClientId() && ebayClientSecret());
}

async function fetchAppToken(): Promise<string> {
  const id = ebayClientId();
  const secret = ebayClientSecret();
  if (!id || !secret) throw new Error('EBAY_BROWSE_CLIENT_ID / _SECRET not set');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE });
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`eBay OAuth failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    // Refresh a minute before the real expiry.
    expiresAt: Date.now() + Math.max(60_000, (json.expires_in - 60) * 1000),
  };
  return cachedToken.token;
}

export async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  return fetchAppToken();
}

export interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  conditionId?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl: string }>;
  seller?: { username?: string; feedbackScore?: number };
  categoryPath?: string;
  buyingOptions?: string[];
}

export interface SearchByImageResponse {
  itemSummaries?: EbayItemSummary[];
  total?: number;
  warnings?: unknown;
}

export async function searchByImage(
  imageBase64: string,
  opts: { limit?: number; marketplaceId?: string } = {},
): Promise<SearchByImageResponse> {
  const token = await getAppToken();
  const url = new URL(SEARCH_URL);
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': opts.marketplaceId ?? MARKETPLACE_ID,
    },
    body: JSON.stringify({ image: imageBase64 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Token may have been revoked server-side; clear cache so the next call
    // re-fetches. Still throw for this call.
    if (res.status === 401) cachedToken = null;
    logger.warn({ status: res.status, text }, 'eBay search_by_image failed');
    throw new Error(`eBay search_by_image failed: ${res.status} ${text}`);
  }
  return (await res.json()) as SearchByImageResponse;
}
