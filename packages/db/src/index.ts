import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { createPool } from './config';
import * as schema from './schema/index';
export { createPool, resolveDatabaseUrl } from './config';
export { schema };
export type Connection = Pick<
  PgDatabase<PgQueryResultHKT, typeof schema>,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;
export interface Database extends Connection {
  transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function connect(url: string): Database {
  const pool = createPool(url);
  const orm = drizzle(pool, { schema });
  return {
    select: orm.select.bind(orm),
    insert: orm.insert.bind(orm),
    update: orm.update.bind(orm),
    delete: orm.delete.bind(orm),
    execute: orm.execute.bind(orm),
    transaction: (fn) => orm.transaction(fn),
    close: () => pool.end(),
  };
}
