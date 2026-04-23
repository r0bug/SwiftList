import bcrypt from 'bcryptjs';
import { PrismaClient } from '../packages/server/src/generated/prisma/index.js';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SWIFTLIST_SEED_EMAIL ?? 'john@robug.com').toLowerCase();
  const password = process.env.SWIFTLIST_SEED_PASSWORD ?? 'ListFast';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: 'John', isAdmin: true },
    update: {},
  });
  console.log(`[seed] user: ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
