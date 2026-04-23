import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { jwtAuth } from '../middleware/auth.js';

const router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const token = jwt.sign({ sub: user.id, email: user.email }, env.JWT_SECRET, {
    expiresIn: '7d',
  });
  res.cookie('swiftlist_jwt', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('swiftlist_jwt');
  res.json({ ok: true });
});

router.get('/me', jwtAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ error: 'User no longer exists' });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
});

export default router;
