import { z } from 'zod';
import { connect } from '@munim/db';
import { createApp } from './app';
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    APP_ORIGIN: z.string().url(),
    QUOTE_SECRET: z.string().min(32),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .parse(process.env);
const db = connect(env.DATABASE_URL);
const app = await createApp(db, {
  origin: new URL(env.APP_ORIGIN).origin,
  quoteSecret: env.QUOTE_SECRET,
  production: env.NODE_ENV === 'production',
  logger: true,
});
app.addHook('onClose', () => db.close());
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ port: env.PORT, host: env.HOST });
