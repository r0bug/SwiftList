// Two auth flavors:
//  - JWT cookie for the web UI (jwtAuth).
//  - X-Api-Key + X-Machine-Id headers for the extension and watcher
//    (apiKeyAuth) — mirrors the comptool/src/middleware/apiKey.js pattern.

import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { sha256String } from '../util/sha256.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; email: string };
    client?: { id: string; apiKeyId: string; machineId?: string };
  }
}

export const jwtAuth: RequestHandler = (req, res, next) => {
  const token = req.cookies?.swiftlist_jwt || req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string; email: string };
    req.user = { id: decoded.sub, email: decoded.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const apiKeyAuth: RequestHandler = async (req, res, next) => {
  const rawKey = req.header('X-Api-Key');
  if (!rawKey) {
    res.status(401).json({ error: 'Missing X-Api-Key header' });
    return;
  }
  const keyHash = sha256String(rawKey);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!apiKey || apiKey.revokedAt) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // Track machine if header present
  const machineId = req.header('X-Machine-Id');
  if (machineId) {
    await prisma.machine.upsert({
      where: { machineId },
      create: {
        machineId,
        apiKeyId: apiKey.id,
        userAgent: req.header('user-agent'),
        lastSeenAt: new Date(),
      },
      update: { lastSeenAt: new Date(), userAgent: req.header('user-agent') },
    });
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  req.client = { id: apiKey.clientId, apiKeyId: apiKey.id, machineId };
  next();
};

/** Either auth flavor. Order matters — JWT first (cheaper). */
export const apiKeyOrJwt: RequestHandler = (req, res, next) => {
  if (req.cookies?.swiftlist_jwt || req.header('Authorization')) {
    jwtAuth(req, res, next);
    return;
  }
  apiKeyAuth(req, res, next);
};
