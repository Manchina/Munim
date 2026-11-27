import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, count, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { migrateTestDatabase } from './testing';
import { pgClass, pgConstraint } from './testing-catalog';

it('keeps migration tables and foreign keys inside the isolated test schema', async () => {
  const pg = new PGlite();
  const db = drizzle(pg);
  const schema = 'munim_test_00000000000000000000000000000001';
  try {
    await db.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
    await db.execute(sql`SET search_path TO ${sql.identifier(schema)}`);
    await migrateTestDatabase((statement) => pg.exec(statement), schema);
    const [tables] = await db
      .select({ count: count() })
      .from(pgClass)
      .where(
        and(eq(pgClass.namespace, sql`current_schema()::regnamespace`), eq(pgClass.kind, 'r')),
      );
    expect(tables?.count).toBe(18);
    const source = alias(pgClass, 'source_relation'),
      target = alias(pgClass, 'target_relation');
    const foreignKeys = await db
      .select({ namespace: source.namespace, referencedNamespace: target.namespace })
      .from(pgConstraint)
      .innerJoin(source, eq(source.oid, pgConstraint.relationId))
      .innerJoin(target, eq(target.oid, pgConstraint.referencedRelationId))
      .where(
        and(eq(pgConstraint.kind, 'f'), eq(source.namespace, sql`current_schema()::regnamespace`)),
      );
    expect(foreignKeys.length).toBeGreaterThan(0);
    expect(foreignKeys.every((key) => key.namespace === key.referencedNamespace)).toBe(true);
    const [publicTables] = await db
      .select({ count: count() })
      .from(pgClass)
      .where(and(eq(pgClass.namespace, sql`'public'::regnamespace`), eq(pgClass.kind, 'r')));
    expect(publicTables?.count).toBe(0);
  } finally {
    await pg.close();
  }
});

it('rejects invalid test schema identifiers before executing migrations', async () => {
  let executed = false;
  await expect(
    migrateTestDatabase(async () => {
      executed = true;
    }, 'public"; DROP SCHEMA public CASCADE; --'),
  ).rejects.toThrow('Invalid test schema');
  expect(executed).toBe(false);
});
