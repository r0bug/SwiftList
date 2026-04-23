// USB plug detection. Polls drivelist on a 5-second interval and detects new
// mountpoints. When a new mount appears, look for DCIM/ and copy contents into
// the watch folder so chokidar picks them up via the normal pipeline.
//
// Phase 0 implementation uses drivelist polling only — `usb-detection`
// integration is deferred to Phase 3 (it requires native compile + udev
// rules on Linux). Polling every 5s is plenty responsive for human-scale
// "I just plugged in my camera" workflows.

import fs from 'node:fs';
import path from 'node:path';
import drivelist from 'drivelist';

interface MountSnapshot {
  mountpoint: string;
  device: string;
  description: string;
}

const POLL_MS = 5000;
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.cr2', '.nef', '.arw', '.dng', '.raw']);

export function startUsbWatcher(importDir: string): NodeJS.Timeout {
  let known: Set<string> = new Set();
  let primed = false;

  const tick = async () => {
    try {
      const drives = await drivelist.list();
      const current = new Set<string>();
      const snapshots: MountSnapshot[] = [];
      for (const d of drives) {
        for (const m of d.mountpoints ?? []) {
          current.add(m.path);
          snapshots.push({ mountpoint: m.path, device: d.device, description: d.description });
        }
      }

      if (!primed) {
        known = current;
        primed = true;
        return;
      }

      const newOnes = [...current].filter((m) => !known.has(m));
      for (const mount of newOnes) {
        const snap = snapshots.find((s) => s.mountpoint === mount);
        if (!snap) continue;
        await maybeImport(snap, importDir).catch((err) =>
          console.error('[usb-import-failed]', mount, (err as Error).message),
        );
      }
      known = current;
    } catch (err) {
      console.error('[usb-poll-error]', (err as Error).message);
    }
  };

  return setInterval(tick, POLL_MS);
}

async function maybeImport(snap: MountSnapshot, importDir: string): Promise<void> {
  const dcim = path.join(snap.mountpoint, 'DCIM');
  if (!fs.existsSync(dcim)) return;
  console.log(`[usb-detected] ${snap.description} at ${snap.mountpoint} — has DCIM, importing`);

  const date = new Date().toISOString().slice(0, 10);
  const safeLabel = snap.description.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40);
  const dest = path.join(importDir, safeLabel || 'unknown-device', date);
  fs.mkdirSync(dest, { recursive: true });

  copyRecursive(dcim, dest);
}

function copyRecursive(src: string, destBase: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const full = path.join(src, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(full, destBase);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!PHOTO_EXTS.has(ext)) continue;
    const dst = path.join(destBase, entry.name);
    if (fs.existsSync(dst)) continue;
    try {
      fs.copyFileSync(full, dst);
      console.log('[usb-copied]', dst);
    } catch (err) {
      console.error('[usb-copy-failed]', full, (err as Error).message);
    }
  }
}
