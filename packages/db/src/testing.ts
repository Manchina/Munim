import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, type Connection, type Database } from './index';
import pgDriver from 'pg';
export async function testDatabase(options: { embedded?: boolean } = {}): Promise<Database> {
  if (process.env.TEST_DATABASE_URL && !options.embedded)
    return realTestDatabase(process.env.TEST_DATABASE_URL);
  const pg = new PGlite();
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort())
    await pg.exec(await readFile(`${directory}/${file}`, 'utf8'));
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
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  try {
    for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort())
      await db.query(await readFile(`${directory}/${file}`, 'utf8'));
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
