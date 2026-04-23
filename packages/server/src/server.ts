import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pinoHttp } from 'pino-http';

// Resolve workspace-root paths regardless of cwd. server.ts lives at
// packages/server/src/server.ts → workspace root is 3 levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const r = (p: string) => (path.isAbsolute(p) ? p : path.resolve(WORKSPACE_ROOT, p));
import { env } from './config/env.js';
import { logger } from './util/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import ingestRoutes from './routes/ingest.routes.js';
import itemsRoutes from './routes/items.routes.js';
import poolRoutes from './routes/pool.routes.js';
import groupsRoutes from './routes/groups.routes.js';
import photosRoutes from './routes/photos.routes.js';
import draftsRoutes from './routes/drafts.routes.js';
import extensionRoutes from './routes/extension.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import settingsRoutes from './routes/settings.routes.js';

const app = express();

app.use(pinoHttp({ logger }));
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Static: optimized image working dir + public hosted images.
const uploadsDir = r(env.UPLOADS_DIR);
const publicImagesDir = r(env.PUBLIC_IMAGES_DIR);
const distDir = r('dist');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.join(publicImagesDir, 'swiftlist'), { recursive: true });
fs.mkdirSync(distDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));
app.use('/public-images', express.static(publicImagesDir));
// dist/ holds the install landing page + extension zip, served via nginx /swift/.
app.use('/dist', express.static(distDir));

app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/ingest', ingestRoutes);
app.use('/api/v1/items', itemsRoutes);
app.use('/api/v1/pool', poolRoutes);
app.use('/api/v1/groups', groupsRoutes);
app.use('/api/v1/photos', photosRoutes);
app.use('/api/v1/drafts', draftsRoutes);
app.use('/api/v1/extension', extensionRoutes);
app.use('/api/v1/devices', devicesRoutes);
app.use('/api/v1/settings', settingsRoutes);

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'swiftlist server started');
});
