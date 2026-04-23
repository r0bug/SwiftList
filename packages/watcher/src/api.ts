import 'dotenv/config';
import axios, { type AxiosInstance } from 'axios';

const baseURL = process.env.SWIFTLIST_API_BASE ?? 'http://localhost:3003';
const apiKey = process.env.SWIFTLIST_API_KEY ?? '';
const machineId = process.env.SWIFTLIST_MACHINE_ID ?? `watcher-${process.pid}`;

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: {
    'X-Api-Key': apiKey,
    'X-Machine-Id': machineId,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

export async function postIngestPhoto(filePath: string, watchFolderId?: string): Promise<void> {
  await api.post('/api/v1/ingest/photo', { path: filePath, watchFolderId });
}
