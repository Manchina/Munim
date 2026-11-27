import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Connection, Database } from '@munim/db';
import { schema } from '@munim/db';
import { and, eq, sql } from 'drizzle-orm';
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
type SerializedValue<T> = T extends Date ? string : T;
type Serialized<T> = { [K in keyof T]: SerializedValue<T[K]> };
function mapRow<T extends object>(row: T): Serialized<T> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const result =
        value instanceof Date
          ? value.toISOString()
          : key.endsWith('Paise') && typeof value === 'string'
            ? Number(value)
            : value;
      if (key.endsWith('Paise') && !Number.isSafeInteger(result))
        fail(422, 'AMOUNT_LIMIT', 'Amount exceeds the supported limit.');
      return [key, result];
    }),
  ) as Serialized<T>;
}
export async function rows<T extends object>(query: PromiseLike<T[]>): Promise<Serialized<T>[]> {
  return (await query).map(mapRow);
}
export async function one<T extends object>(query: PromiseLike<T[]>): Promise<Serialized<T>> {
  const found = await rows(query);
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
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${storeId}:${operation}:${key}`}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(schema.idempotencyRecords)
      .where(
        and(
          eq(schema.idempotencyRecords.storeId, storeId),
          eq(schema.idempotencyRecords.operation, operation),
          eq(schema.idempotencyRecords.key, key!),
        ),
      );
    if (prior) {
      if (prior.requestHash !== requestHash)
        fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different request.');
      return prior.response as T;
    }
    const result = await fn(tx);
    await tx
      .insert(schema.idempotencyRecords)
      .values({ storeId, operation, key: key!, requestHash, response: result });
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
