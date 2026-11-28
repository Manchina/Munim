import { hashPassword } from '../../packages/db/src/password';
import { testDatabase } from '../../packages/db/src/testing';
import { seedDemo } from '../../packages/db/src/seed';
import { createApp } from '../../apps/api/src/app';
const db = await testDatabase();
await seedDemo(db, 'browser@test.local', await hashPassword('Browser-password-123!'));
const app = await createApp(db, {
  origin: 'http://localhost:5173',
  quoteSecret: 'browser-test-secret-with-32-characters',
});
app.addHook('onClose', () => db.close());
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: '127.0.0.1', port: 3000 });
