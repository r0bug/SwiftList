// Ingestion-pipeline DTOs (watcher ↔ server).

export type IngestDecision =
  | 'NEW_ITEM'
  | 'ADDED_TO_ITEM'
  | 'DUPLICATE_SKIPPED'
  | 'GROUPED_PENDING'
  | 'ERROR';

export interface IngestPhotoRequest {
  /** Absolute path on the watcher host. Server reads the file directly when
   *  watcher and server share a filesystem; otherwise multipart upload is
   *  used (see optional `inline` field). */
  path: string;
  /** Optional inline upload (base64). For watchers running on remote hosts. */
  inline?: { base64: string; filename: string; mime: string };
  /** Originating WatchFolder (for routing + audit). */
  watchFolderId?: string;
}

export interface IngestPhotoResponse {
  jobId: string;
  status: 'queued' | 'duplicate-skipped';
  sha256: string;
}

export interface PhotoFingerprint {
  sha256: string;
  perceptualHash: string;
  capturedAt?: string;
  filenameNumeric?: number;
  cameraModel?: string;
}

export type GroupingFeature =
  | 'same-folder'
  | 'consecutive-filename'
  | 'close-timestamp'
  | 'close-perceptual-hash';

export interface GroupingDecision {
  groupKey: string;
  members: string[]; // photo IDs
  features: GroupingFeature[];
  candidateExistingItemId?: string;
  candidateExistingItemConfidence?: number;
}
