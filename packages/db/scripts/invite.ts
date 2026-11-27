import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { connect } from '../src/index';
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
      await tx.query<{ id: string }>('INSERT INTO stores(name) VALUES($1) RETURNING id', [
        storeName,
      ])
    )[0]!;
    await tx.query(
      "INSERT INTO account_invites(store_id,email,role,token_hash,expires_at) VALUES($1,$2,'owner',$3,now()+interval '2 days')",
      [store.id, email, createHash('sha256').update(raw).digest('hex')],
    );
  });
  console.log(`Share privately with ${email}: ${new URL(env.APP_ORIGIN).origin}/invite#${raw}`);
} finally {
  await db.close();
}
