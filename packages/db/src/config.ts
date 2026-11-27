import pg from 'pg';

/** Resolve credentials only on the server; never expose the resolved URL in logs. */
export function resolveDatabaseUrl(raw: string, password = process.env.DATABASE_PASSWORD): string {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (!url.password && password) url.password = password;
  const supabase =
    url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.pooler.supabase.com');
  if (supabase) {
    if (!url.password)
      throw new Error('Set DATABASE_PASSWORD in .env before connecting to Supabase.');
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

export function createPool(url: string): pg.Pool {
  return new pg.Pool({
    connectionString: resolveDatabaseUrl(url),
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
}
