import { Router } from 'express';
import { prisma } from '../db/prisma.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      service: 'swiftlist',
      version: process.env.npm_package_version ?? '0.1.0',
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: (err as Error).message });
  }
});

export default router;
