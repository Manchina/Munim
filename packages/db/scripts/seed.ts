import { z } from 'zod';
import { connect, hashPassword } from '../src/index';
import { seedDemo } from '../src/seed';
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SEED_EMAIL: z.string().email(),
    SEED_PASSWORD: z.string().min(12).max(128),
  })
  .parse(process.env);
const db = connect(env.DATABASE_URL);
try {
  const result = await seedDemo(db, env.SEED_EMAIL, await hashPassword(env.SEED_PASSWORD));
  console.log(
    `Created demo store ${result.storeId} for ${env.SEED_EMAIL}. Existing accounts are never reset.`,
  );
} finally {
  await db.close();
}
