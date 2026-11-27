import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Connection, Database } from '@munim/db';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new AppError(status, code, message);
};
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
// pg returns int8 as strings. Convert only known bounded money fields at the repository boundary.
function mapRow(row: object): object {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const name = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const result =
        value instanceof Date
          ? value.toISOString()
          : key.endsWith('_paise') && typeof value === 'string'
            ? Number(value)
            : value;
      if (key.endsWith('_paise') && !Number.isSafeInteger(result))
        fail(422, 'AMOUNT_LIMIT', 'Amount exceeds the supported limit.');
      return [name, result];
    }),
  );
}
export async function rows<T extends object>(
  db: Connection,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query(sql, params)).map((r) => mapRow(r) as T);
}
export async function one<T extends object>(
  db: Connection,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const found = await rows<T>(db, sql, params);
  return found[0] ?? fail(404, 'NOT_FOUND', 'Resource was not found.');
}
export async function idempotent<T>(
  db: Database,
  storeId: string,
  operation: string,
  key: string | undefined,
  input: unknown,
  fn: (tx: Connection) => Promise<T>,
): Promise<T> {
  if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key))
    fail(
      400,
      'IDEMPOTENCY_REQUIRED',
      'Provide an Idempotency-Key of 16–100 letters, digits, hyphens or underscores.',
    );
  const requestHash = hash(canonical(input));
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${storeId}:${operation}:${key}`,
    ]);
    const [prior] = await rows<{ requestHash: string; response: T }>(
      tx,
      'SELECT request_hash,response FROM idempotency_records WHERE store_id=$1 AND operation=$2 AND key=$3',
      [storeId, operation, key],
    );
    if (prior) {
      if (prior.requestHash !== requestHash)
        fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different request.');
      return prior.response;
    }
    const result = await fn(tx);
    await tx.query(
      'INSERT INTO idempotency_records(store_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)',
      [storeId, operation, key, requestHash, JSON.stringify(result)],
    );
    return result;
  });
}
export function sign(value: unknown, secret: string) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verify(signed: string, secret: string): unknown {
  const [body, signature, extra] = signed.split('.');
  if (!body || !signature || extra) fail(422, 'INVALID_QUOTE', 'Request a new preview.');
  const expected = createHmac('sha256', secret).update(body!).digest();
  const actual = Buffer.from(signature!, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    fail(422, 'INVALID_QUOTE', 'Request a new preview.');
  try {
    return JSON.parse(Buffer.from(body!, 'base64url').toString());
  } catch {
    return fail(422, 'INVALID_QUOTE', 'Request a new preview.');
  }
}
