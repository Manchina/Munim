import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, type Connection, type Database } from './index';
import pgDriver from 'pg';
export async function testDatabase(options: { embedded?: boolean } = {}): Promise<Database> {
  if (process.env.TEST_DATABASE_URL && !options.embedded)
    return realTestDatabase(process.env.TEST_DATABASE_URL);
  const pg = new PGlite();
  await migrateTestDatabase((sql) => pg.exec(sql));
  const connection: Connection = {
    async query<T extends object>(sql: string, values?: unknown[]) {
      return (await pg.query<T>(sql, values)).rows;
    },
  };
  return {
    ...connection,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({
          async query<T extends object>(sql: string, values?: unknown[]) {
            return (await tx.query<T>(sql, values)).rows;
          },
        }),
      ),
    close: () => pg.close(),
  };
}
async function realTestDatabase(url: string): Promise<Database> {
  const admin = new pgDriver.Pool({ connectionString: url });
  const schema = `munim_test_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!/^munim_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set('options', `-csearch_path=${schema}`);
  const db = connect(scopedUrl.toString());
  try {
    await migrateTestDatabase((sql) => db.query(sql), schema);
  } catch (e) {
    await db.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw e;
  }
  return {
    ...db,
    async close() {
      await db.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
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
