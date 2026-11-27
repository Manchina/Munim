import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { connect, schema } from '../src/index';
const env = z
  .object({ DATABASE_URL: z.string().url(), APP_ORIGIN: z.string().url() })
  .parse(process.env);
const email = z.string().email().parse(process.argv[2]).toLowerCase();
const storeName = z.string().trim().min(1).parse(process.argv[3]);
const db = connect(env.DATABASE_URL);
try {
  const raw = randomBytes(32).toString('base64url');
  await db.transaction(async (tx) => {
    const store = (
      await tx.insert(schema.stores).values({ name: storeName }).returning({ id: schema.stores.id })
    )[0]!;
    await tx.insert(schema.invites).values({
      storeId: store.id,
      email,
      role: 'owner',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 2 * 86400000),
    });
  });
  console.log(`Share privately with ${email}: ${new URL(env.APP_ORIGIN).origin}/invite#${raw}`);
} finally {
  await db.close();
}
