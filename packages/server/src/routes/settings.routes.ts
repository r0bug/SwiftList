// User-facing settings endpoints: API key management + password change.
// All routes require a JWT cookie (web UI only).

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma.js';
import { jwtAuth } from '../middleware/auth.js';
import { sha256String } from '../util/sha256.js';
import { pstr } from '../util/req.js';

const router = Router();

// GET /api/v1/settings/api-keys — list all ApiKeys with their Client.
router.get('/api-keys', jwtAuth, async (_req, res) => {
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { id: true, name: true, email: true } } },
  });
  res.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      clientId: k.clientId,
      client: k.client,
      revokedAt: k.revokedAt,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })),
  });
});

// POST /api/v1/settings/api-keys — create a new API key.
// Mirrors extension.routes.ts register flow: creates Client + ApiKey, hashes
// plaintext with sha256, and returns the plaintext key ONCE.
const CreateKeySchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1).optional(),
});

router.post('/api-keys', jwtAuth, async (req, res) => {
  const parsed = CreateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const client = await prisma.client.create({
    data: { name: parsed.data.clientName ?? 'web' },
  });
  const rawKey = `sl_${randomBytes(24).toString('hex')}`;
  const apiKey = await prisma.apiKey.create({
    data: { clientId: client.id, keyHash: sha256String(rawKey), name: parsed.data.name },
  });
  res.status(201).json({ id: apiKey.id, apiKey: rawKey, clientId: client.id });
});

// POST /api/v1/settings/api-keys/:id/revoke — mark revokedAt = now.
router.post('/api-keys/:id/revoke', jwtAuth, async (req, res) => {
  const existing = await prisma.apiKey.findUnique({ where: { id: pstr(req.params.id) } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const updated = await prisma.apiKey.update({
    where: { id: pstr(req.params.id) },
    data: { revokedAt: existing.revokedAt ?? new Date() },
  });
  res.json({ id: updated.id, revokedAt: updated.revokedAt });
});

// POST /api/v1/settings/password — change the current user's password.
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post('/password', jwtAuth, async (req, res) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ error: 'User no longer exists' });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

export default router;
