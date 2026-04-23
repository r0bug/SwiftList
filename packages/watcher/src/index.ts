import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { watch } from './chokidarWatcher.js';
import { startUsbWatcher } from './usbWatcher.js';

// Walk up from cwd to find the nearest .env so the watcher works from any
// workspace dir. Mirrors packages/server/src/config/env.ts behavior.
(function loadEnv() {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cur, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return;
    cur = parent;
  }
})();

const watchFolder = process.env.SWIFTLIST_WATCH_FOLDER ?? path.resolve(process.cwd(), 'inbox');
const importDir = process.env.SWIFTLIST_IMPORT_DIR ?? path.join(watchFolder, '_usb');

fs.mkdirSync(watchFolder, { recursive: true });
fs.mkdirSync(importDir, { recursive: true });

console.log(`[swiftlist-watcher] watching ${watchFolder}`);
console.log(`[swiftlist-watcher] usb import → ${importDir}`);

watch(watchFolder);
startUsbWatcher(importDir);

process.on('SIGINT', () => {
  console.log('\n[swiftlist-watcher] shutting down');
  process.exit(0);
});
