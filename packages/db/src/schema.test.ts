import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './testing';

it('keeps server tables private from Supabase Data API roles', async () => {
  const db = await testDatabase({ embedded: true });
  try {
    await db.query('CREATE ROLE anon NOLOGIN');
    await db.query('CREATE ROLE authenticated NOLOGIN');
    await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated');
    const migration = await readFile(
      new URL('../migrations/0002_supabase_api_isolation.sql', import.meta.url),
      'utf8',
    );
    for (const command of migration.split('--> statement-breakpoint')) {
      if (command.trim()) await db.query(command);
    }
    const tables = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' AND relrowsecurity=true",
    );
    expect(tables[0]?.count).toBe(18);
    for (const role of ['anon', 'authenticated']) {
      const privileges = await db.query<{ permitted: boolean }>(
        "SELECT has_table_privilege($1,'users','SELECT') AS permitted",
        [role],
      );
      expect(privileges[0]?.permitted).toBe(false);
    }
  } finally {
    await db.close();
  }
});
