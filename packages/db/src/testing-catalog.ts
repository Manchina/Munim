import { boolean, char, integer, pgSchema, text } from 'drizzle-orm/pg-core';

// Read-only PostgreSQL catalogs used to verify migration isolation and permissions.
const catalog = pgSchema('pg_catalog');
export const pgClass = catalog.table('pg_class', {
  oid: integer('oid').notNull(),
  namespace: integer('relnamespace').notNull(),
  kind: char('relkind').notNull(),
  rowSecurity: boolean('relrowsecurity').notNull(),
});
export const pgConstraint = catalog.table('pg_constraint', {
  kind: char('contype').notNull(),
  relationId: integer('conrelid').notNull(),
  referencedRelationId: integer('confrelid').notNull(),
});
export const pgRoles = catalog.table('pg_roles', {
  name: text('rolname').notNull(),
});
