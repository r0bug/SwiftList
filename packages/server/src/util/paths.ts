// Anchor relative config paths (UPLOADS_DIR, PUBLIC_IMAGES_DIR) to the
// monorepo root regardless of which workspace's cwd the server was launched
// from. Mirrors the `r()` helper in server.ts so every file-writing service
// agrees on where those dirs actually live.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
// src/util/paths.ts → workspace root is four levels up:
//   src/util → src → server → packages → swiftlist
const WORKSPACE_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');

export function resolveConfigPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(WORKSPACE_ROOT, p);
}

export { WORKSPACE_ROOT };
