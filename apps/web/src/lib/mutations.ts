import { get, set, del } from 'idb-keyval';
import { api, ApiError } from './api';
export type PendingWrite = { path: string; body: unknown; key: string };
export const pendingKey = (scope: string) => `pending-write:${scope}`;
export async function durableWrite<T>(scope: string, path: string, body: unknown): Promise<T> {
  const storageKey = pendingKey(scope);
  const pending = await get<PendingWrite>(storageKey);
  if (pending && (pending.path !== path || JSON.stringify(pending.body) !== JSON.stringify(body)))
    throw new Error(
      'Resolve the pending store update using Retry before submitting another update.',
    );
  const value = pending ?? { path, body, key: crypto.randomUUID() };
  await set(storageKey, value);
  try {
    const result = await api<T>(path, 'POST', body, value.key);
    await del(storageKey);
    return result;
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) await del(storageKey);
    throw e;
  }
}
