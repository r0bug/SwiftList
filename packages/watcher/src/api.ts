// Lazy-resolve env vars per request. Doing this at module load would
// capture values before index.ts's .env walkup has run (ESM imports are
// depth-first, so this file's top level runs before index.ts's body).

import axios, { type AxiosInstance } from 'axios';

let cached: { client: AxiosInstance; baseURL: string } | null = null;

function makeClient(): { client: AxiosInstance; baseURL: string } {
  const baseURL = process.env.SWIFTLIST_API_BASE ?? 'http://localhost:3004';
  const apiKey = process.env.SWIFTLIST_API_KEY ?? '';
  const machineId = process.env.SWIFTLIST_MACHINE_ID ?? `watcher-${process.pid}`;
  const client = axios.create({
    baseURL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Machine-Id': machineId,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
  return { client, baseURL };
}

function getClient(): AxiosInstance {
  if (!cached) cached = makeClient();
  return cached.client;
}

export async function postIngestPhoto(filePath: string, watchFolderId?: string): Promise<void> {
  await getClient().post('/api/v1/ingest/photo', { path: filePath, watchFolderId });
}
