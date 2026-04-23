import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';

// Walk up from cwd to find the nearest .env (lets the server run from any dir).
function findEnv(start: string): string | null {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cur, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
const envPath = findEnv(process.cwd());
if (envPath) dotenv.config({ path: envPath });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3003),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PUBLIC_IMAGE_BASE_URL: z.string().default('http://localhost:3003'),
  PUBLIC_IMAGES_DIR: z.string().default('public-images'),
  UPLOADS_DIR: z.string().default('uploads'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  AI_BATCH_SIZE: z.coerce.number().default(20),
  IMAGE_MIRROR: z.enum(['', 's3']).default(''),
  COMPTOOL_MIRROR_BASE: z.string().optional(),
  COMPTOOL_MIRROR_API_KEY: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
