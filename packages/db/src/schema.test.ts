import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { and, count, eq, sql } from 'drizzle-orm';
import { testDatabase } from './testing';
import { pgClass, pgRoles } from './testing-catalog';

it('keeps server tables private from Supabase Data API roles', async () => {
  const db = await testDatabase({ embedded: true });
  try {
    await db.execute(sql`CREATE ROLE anon NOLOGIN`);
    await db.execute(sql`CREATE ROLE authenticated NOLOGIN`);
    await db.execute(sql`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated`);
    const migration = await readFile(
      new URL('../migrations/0002_supabase_api_isolation.sql', import.meta.url),
      'utf8',
    );
    for (const command of migration.split('--> statement-breakpoint'))
      if (command.trim()) await db.execute(sql.raw(command));
    const [tables] = await db
      .select({ count: count() })
      .from(pgClass)
      .where(
        and(
          eq(pgClass.namespace, sql`current_schema()::regnamespace`),
          eq(pgClass.kind, 'r'),
          eq(pgClass.rowSecurity, true),
        ),
      );
    expect(tables?.count).toBe(18);
    for (const role of ['anon', 'authenticated']) {
      const [privileges] = await db
        .select({ permitted: sql<boolean>`has_table_privilege(${role}, 'users', 'SELECT')` })
        .from(pgRoles)
        .where(eq(pgRoles.name, role));
      expect(privileges?.permitted).toBe(false);
    }
  } finally {
    await db.close();
  }
});
