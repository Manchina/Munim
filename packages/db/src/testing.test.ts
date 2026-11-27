import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { migrateTestDatabase } from './testing';

it('keeps migration tables and foreign keys inside the isolated test schema', async () => {
  const pg = new PGlite();
  const schema = 'munim_test_00000000000000000000000000000001';
  try {
    await pg.exec(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    await migrateTestDatabase((sql) => pg.exec(sql), schema);
    const tables = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r'",
    );
    expect(tables.rows[0]?.count).toBe(18);
    const foreignKeys = await pg.query<{ schema: string; referenced_schema: string }>(
      `SELECT source.relnamespace::regnamespace::text AS schema,
              target.relnamespace::regnamespace::text AS referenced_schema
       FROM pg_constraint constraint_record
       JOIN pg_class source ON source.oid=constraint_record.conrelid
       JOIN pg_class target ON target.oid=constraint_record.confrelid
       WHERE constraint_record.contype='f' AND source.relnamespace=current_schema()::regnamespace`,
    );
    expect(foreignKeys.rows.length).toBeGreaterThan(0);
    expect(
      foreignKeys.rows.every((key) => key.schema === schema && key.referenced_schema === schema),
    ).toBe(true);
    const publicTables = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'",
    );
    expect(publicTables.rows[0]?.count).toBe(0);
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
