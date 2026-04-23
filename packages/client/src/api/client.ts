const BASE = '/api/v1';

export class AuthError extends Error {
  constructor() {
    super('unauthenticated');
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) {
    throw new AuthError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
}

export const api = {
  login: (email: string, password: string) =>
    http<{ token: string; user: Me }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => http<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => http<Me>('/auth/me'),
  listItems: (q?: string) =>
    http<{ items: ItemRow[]; nextCursor: string | null }>(
      `/items${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  getItem: (id: string) => http<ItemDetail>(`/items/${id}`),
  patchItem: (id: string, body: Partial<ItemDetail>) =>
    http<ItemDetail>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listPool: (cursor?: string) =>
    http<{ photos: PoolPhoto[]; nextCursor: string | null; total: number }>(
      `/pool${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  listDrafts: (cursor?: string) =>
    http<{ drafts: DraftRow[]; nextCursor: string | null }>(
      `/drafts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  listDevices: () => http<{ devices: Device[] }>('/devices'),
  listApiKeys: () => http<{ keys: ApiKeyRow[] }>('/settings/api-keys'),
  createApiKey: (body: { name: string; clientName?: string }) =>
    http<{ id: string; apiKey: string; clientId: string }>('/settings/api-keys', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeApiKey: (id: string) =>
    http<{ id: string; revokedAt: string }>(`/settings/api-keys/${id}/revoke`, {
      method: 'POST',
    }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    http<{ ok: true }>('/settings/password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mergeItemInto: (sourceId: string, targetId: string) =>
    http<{ ok: true; mergedInto: string }>(`/items/${sourceId}/merge-into`, {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }),
  movePhotos: (sourceId: string, photoIds: string[], targetItemId: string) =>
    http<{ ok: true; moved: number }>(`/items/${sourceId}/photos/move`, {
      method: 'POST',
      body: JSON.stringify({ photoIds, targetItemId }),
    }),
  getIngestHint: () => http<{ hint: string }>('/settings/ingest-hint'),
  setIngestHint: (hint: string) =>
    http<{ hint: string }>('/settings/ingest-hint', {
      method: 'PUT',
      body: JSON.stringify({ hint }),
    }),
};

export interface ApiKeyRow {
  id: string;
  name: string | null;
  clientId: string;
  client: { id: string; name: string; email: string | null };
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Device {
  id: string;
  machineId: string;
  userAgent: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  apiKey: {
    id: string;
    name: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
  };
  client: {
    id: string;
    name: string;
    email: string | null;
  };
}

export interface DraftRow {
  id: string;
  itemId: string;
  ebayDraftId: string | null;
  ebayDraftUrl: string;
  accountHint: string | null;
  status: 'OPEN' | 'SUBMITTED' | 'ABANDONED' | 'UNKNOWN';
  lastSeenAt: string;
  lastFilledAt: string | null;
  createdAt: string;
  updatedAt: string;
  item: { id: string; title: string | null; brand: string | null };
}

export interface PoolPhoto {
  id: string;
  thumbnailPath: string | null;
  publicUrl: string | null;
  cdnUrl: string | null;
  originalPath: string | null;
  createdAt: string;
  photoGroupId: string | null;
}

export interface ItemRow {
  id: string;
  title: string | null;
  brand: string | null;
  status: string;
  stage: string;
  completeness: { score?: number } | null;
  photos: { id: string; thumbnailPath: string | null; publicUrl: string | null }[];
  _count: { photos: number; soldComps: number; drafts: number };
}

export interface ItemDetail extends ItemRow {
  description: string | null;
  category: string | null;
  ebayCategoryId: string | null;
  condition: string | null;
  startingPrice: number | null;
  buyNowPrice: number | null;
  itemSpecifics: Record<string, string> | null;
  drafts: Array<{ id: string; ebayDraftUrl: string; status: string; lastSeenAt: string }>;
  soldComps: Array<{ id: string; ebayItemId: string; soldPrice: number | null; title: string | null }>;
}
