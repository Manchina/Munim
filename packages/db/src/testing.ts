import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, type Connection, type Database } from './index';
import pgDriver from 'pg';
import { drizzle } from 'drizzle-orm/pglite';
import { drizzle as postgresDrizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index';
export async function testDatabase(options: { embedded?: boolean } = {}): Promise<Database> {
  if (process.env.TEST_DATABASE_URL && !options.embedded)
    return realTestDatabase(process.env.TEST_DATABASE_URL);
  const pg = new PGlite();
  await migrateTestDatabase((sql) => pg.exec(sql));
  const orm = drizzle(pg, { schema });
  const connection: Connection = {
    select: orm.select.bind(orm),
    insert: orm.insert.bind(orm),
    update: orm.update.bind(orm),
    delete: orm.delete.bind(orm),
    execute: orm.execute.bind(orm),
  };
  return {
    ...connection,
    transaction: (fn) => orm.transaction(fn),
    close: () => pg.close(),
  };
}
async function realTestDatabase(url: string): Promise<Database> {
  const adminPool = new pgDriver.Pool({ connectionString: url });
  const admin = postgresDrizzle(adminPool);
  const schema = `munim_test_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!/^munim_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema');
  await admin.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set('options', `-csearch_path=${schema}`);
  const db = connect(scopedUrl.toString());
  try {
    await migrateTestDatabase((statement) => db.execute(sql.raw(statement)), schema);
  } catch (e) {
    await db.close();
    await admin.execute(sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`);
    await adminPool.end();
    throw e;
  }
  return {
    ...db,
    async close() {
      await db.close();
      await admin.execute(sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`);
      await adminPool.end();
    },
  };
}

/** Remap generated public references only when preparing an isolated test schema. */
export async function migrateTestDatabase(
  execute: (sql: string) => Promise<unknown>,
  schema = 'public',
): Promise<void> {
  if (!/^(public|munim_test_[a-f0-9]{32})$/.test(schema)) throw new Error('Invalid test schema');
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = await readFile(`${directory}/${file}`, 'utf8');
    await execute(sql.replaceAll('"public".', `"${schema}".`));
  }
}
