import pg from 'pg';
import { createPool } from './config';
export { createPool, resolveDatabaseUrl } from './config';
export * as schema from './schema/index';
export interface Connection {
  query<T extends object>(sql: string, values?: unknown[]): Promise<T[]>;
}
export interface Database extends Connection {
  transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function connect(url: string): Database {
  const pool = createPool(url);
  const wrap = (client: pg.Pool | pg.PoolClient): Connection => ({
    async query<T extends object>(sql: string, values?: unknown[]) {
      return ((await client.query(sql, values)).rows as T[]) ?? [];
    },
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await fn(wrap(client));
        await client.query('COMMIT');
        return value;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
