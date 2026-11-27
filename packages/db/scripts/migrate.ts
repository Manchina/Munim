import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from '../src/config';
import { z } from 'zod';
const pool = createPool(z.string().url().parse(process.env.DATABASE_URL));
try {
  await migrate(drizzle(pool), { migrationsFolder: 'packages/db/migrations' });
  console.log('Migrations applied.');
} finally {
  await pool.end();
}
