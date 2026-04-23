// Prisma client singleton. Generated client lives at src/generated/prisma per
// the schema's `output` setting, but we re-export from the package name so app
// code stays portable in case we move generation back to node_modules later.

import { PrismaClient } from '../generated/prisma/index.js';

declare global {
  // eslint-disable-next-line no-var
  var __swiftlistPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__swiftlistPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__swiftlistPrisma = prisma;
}
