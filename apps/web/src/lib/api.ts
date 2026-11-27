import type { Page } from '@munim/contracts';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      value.error?.message ?? 'Request failed.',
      response.status,
      value.error?.code ?? 'REQUEST_FAILED',
    );
  return value as T;
}
export async function allPages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  do {
    const value: Page<T> = await api(
      `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${cursor}` : ''}`,
    );
    result.push(...value.items);
    cursor = value.nextCursor;
  } while (cursor);
  return result;
}
export function decimalAmount(paise: number | bigint): string {
  const value = BigInt(paise),
    absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function inr(paise: number | bigint): string {
  const value = BigInt(paise),
    absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}₹${new Intl.NumberFormat('en-IN').format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
