import { describe, it, expect } from 'vitest';
import { resolveDatabaseUrl } from './config';

describe('PostgreSQL connection configuration', () => {
  it('adds a separate password with URL-safe encoding and verified TLS', () => {
    const url = new URL(
      resolveDatabaseUrl(
        'postgresql://postgres@db.example.supabase.co:5432/postgres',
        'p@ss:#/? word',
      ),
    );
    expect(decodeURIComponent(url.password)).toBe('p@ss:#/? word');
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
  });
  it('keeps the pooler username and an existing encoded password', () => {
    const url = new URL(
      resolveDatabaseUrl(
        'postgresql://postgres.project:existing%40password@aws-0-region.pooler.supabase.com:5432/postgres',
        'different',
      ),
    );
    expect(url.username).toBe('postgres.project');
    expect(decodeURIComponent(url.password)).toBe('existing@password');
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
  });
  it('requires Supabase credentials without revealing the connection URL', () => {
    expect(() =>
      resolveDatabaseUrl('postgresql://postgres@db.example.supabase.co/postgres', ''),
    ).toThrow('Set DATABASE_PASSWORD');
  });
  it('preserves isolated test database options', () => {
    const url = new URL(
      resolveDatabaseUrl(
        'postgres://test:secret@localhost:5432/test?options=-csearch_path%3Dmunim_test',
        '',
      ),
    );
    expect(url.searchParams.get('sslmode')).toBeNull();
    expect(url.searchParams.get('options')).toBe('-csearch_path=munim_test');
  });
  it('rejects other database protocols', () => {
    expect(() => resolveDatabaseUrl('https://example.com', '')).toThrow(
      'PostgreSQL connection URL',
    );
  });
});
