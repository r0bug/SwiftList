import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { watch } from './chokidarWatcher.js';
import { startUsbWatcher } from './usbWatcher.js';

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
