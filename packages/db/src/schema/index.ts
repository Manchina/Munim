import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  unique,
  check,
  foreignKey,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';
const pk = () => uuid('id').primaryKey().defaultRandom();
const time = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'number' });
const store = () =>
  uuid('store_id')
    .notNull()
    .references(() => stores.id);
export const users = pgTable('users', {
  id: pk(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: time(),
}).enableRLS();
export const stores = pgTable(
  'stores',
  {
    id: pk(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    creditConfirmationThresholdPaise: money('credit_confirmation_threshold_paise')
      .notNull()
      .default(100000),
    pavGrams: integer('pav_grams'),
    upiPayee: text('upi_payee'),
    upiName: text('upi_name'),
    settingsVersion: integer('settings_version').notNull().default(1),
  },
  (t) => [
    check(
      'store_threshold',
      sql`${t.creditConfirmationThresholdPaise} BETWEEN 0 AND 9007199254740991`,
    ),
    check('store_pav', sql`${t.pavGrams} IS NULL OR ${t.pavGrams} > 0`),
  ],
).enableRLS();
export const memberships = pgTable(
  'store_memberships',
  {
    storeId: store(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (t) => [
    unique().on(t.storeId, t.userId),
    check('membership_role', sql`${t.role} IN ('owner','staff')`),
  ],
).enableRLS();
export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: time(),
  },
  (t) => [index('session_expiry').on(t.expiresAt)],
).enableRLS();
export const invites = pgTable(
  'account_invites',
  {
    id: pk(),
    storeId: store(),
    email: text('email').notNull(),
    role: text('role').notNull().default('staff'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: time(),
  },
  (t) => [check('invite_role', sql`${t.role} IN ('owner','staff')`)],
).enableRLS();
export const suppliers = pgTable(
  'suppliers',
  {
    id: pk(),
    storeId: store(),
    name: text('name').notNull(),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: time(),
  },
  (t) => [unique().on(t.storeId, t.id)],
).enableRLS();
export const products = pgTable(
  'products',
  {
    id: pk(),
    storeId: store(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    variant: text('variant').notNull().default(''),
    sku: text('sku'),
    baseUnit: text('base_unit').notNull(),
    priceQuantity: integer('price_quantity').notNull(),
    pricePaise: money('price_paise').notNull(),
    safetyStock: integer('safety_stock').notNull().default(0),
    supplierId: uuid('supplier_id'),
    version: integer('version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: time(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.sku),
    foreignKey({
      columns: [t.storeId, t.supplierId],
      foreignColumns: [suppliers.storeId, suppliers.id],
    }),
    index('product_search').on(t.storeId, t.normalizedName),
    check(
      'product_values',
      sql`${t.baseUnit} IN ('gram','each') AND ${t.priceQuantity} > 0 AND ${t.pricePaise} BETWEEN 0 AND 9007199254740991 AND ${t.safetyStock} >= 0`,
    ),
  ],
).enableRLS();
export const productAliases = pgTable(
  'product_aliases',
  {
    id: pk(),
    storeId: store(),
    productId: uuid('product_id').notNull(),
    alias: text('alias').notNull(),
  },
  (t) => [
    unique().on(t.storeId, t.productId, t.alias),
    foreignKey({
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    index('product_alias_lookup').on(t.storeId, t.alias),
  ],
).enableRLS();
export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    storeId: store(),
    productId: uuid('product_id').notNull(),
    quantity: integer('quantity').notNull().default(0),
  },
  (t) => [
    unique().on(t.storeId, t.productId),
    foreignKey({
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    check('inventory_nonnegative', sql`${t.quantity} >= 0`),
  ],
).enableRLS();
export const customers = pgTable(
  'customers',
  {
    id: pk(),
    storeId: store(),
    name: text('name').notNull(),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: time(),
  },
  (t) => [unique().on(t.storeId, t.id), index('customer_lookup').on(t.storeId, t.name)],
).enableRLS();
export const customerAliases = pgTable(
  'customer_aliases',
  {
    id: pk(),
    storeId: store(),
    customerId: uuid('customer_id').notNull(),
    alias: text('alias').notNull(),
  },
  (t) => [
    unique().on(t.storeId, t.customerId, t.alias),
    foreignKey({
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }),
  ],
).enableRLS();
export const sales = pgTable(
  'sales',
  {
    id: pk(),
    storeId: store(),
    customerId: uuid('customer_id'),
    paymentMethod: text('payment_method').notNull(),
    totalPaise: money('total_paise').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    foreignKey({
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }),
    index('sales_history').on(t.storeId, t.createdAt),
    check(
      'sale_values',
      sql`${t.totalPaise} BETWEEN 0 AND 9007199254740991 AND ${t.paymentMethod} IN ('cash','upi','credit') AND (${t.paymentMethod} <> 'credit' OR ${t.customerId} IS NOT NULL)`,
    ),
  ],
).enableRLS();
export const saleItems = pgTable(
  'sale_items',
  {
    id: pk(),
    storeId: store(),
    saleId: uuid('sale_id').notNull(),
    productId: uuid('product_id').notNull(),
    name: text('name').notNull(),
    variant: text('variant').notNull(),
    baseUnit: text('base_unit').notNull(),
    quantity: integer('quantity').notNull(),
    priceQuantity: integer('price_quantity').notNull(),
    pricePaise: money('price_paise').notNull(),
    lineTotalPaise: money('line_total_paise').notNull(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    foreignKey({ columns: [t.storeId, t.saleId], foreignColumns: [sales.storeId, sales.id] }),
    foreignKey({
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    check(
      'sale_item_values',
      sql`${t.quantity} > 0 AND ${t.priceQuantity} > 0 AND ${t.baseUnit} IN ('gram','each') AND ${t.pricePaise} BETWEEN 0 AND 9007199254740991 AND ${t.lineTotalPaise} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
).enableRLS();
export const khataEntries = pgTable(
  'khata_entries',
  {
    id: pk(),
    storeId: store(),
    customerId: uuid('customer_id').notNull(),
    kind: text('kind').notNull(),
    amountPaise: money('amount_paise').notNull(),
    saleId: uuid('sale_id'),
    method: text('method'),
    reference: text('reference'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    unique().on(t.storeId, t.saleId),
    foreignKey({
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }),
    foreignKey({ columns: [t.storeId, t.saleId], foreignColumns: [sales.storeId, sales.id] }),
    index('khata_history').on(t.storeId, t.customerId, t.createdAt),
    check(
      'khata_values',
      sql`${t.amountPaise} BETWEEN 1 AND 9007199254740991 AND ((${t.kind} = 'sale_debit' AND ${t.saleId} IS NOT NULL AND ${t.method} IS NULL) OR (${t.kind} = 'payment' AND ${t.saleId} IS NULL AND ${t.method} IN ('cash','upi')))`,
    ),
  ],
).enableRLS();
export const restockRequests = pgTable(
  'restock_requests',
  {
    id: pk(),
    storeId: store(),
    productId: uuid('product_id'),
    name: text('name').notNull(),
    variant: text('variant').notNull().default(''),
    demandKey: text('demand_key').notNull(),
    supplierId: uuid('supplier_id'),
    requestCount: integer('request_count').notNull().default(1),
    status: text('status').notNull().default('open'),
    createdAt: time(),
    lastRequestedAt: timestamp('last_requested_at', { withTimezone: true }).notNull().defaultNow(),
    procuredAt: timestamp('procured_at', { withTimezone: true }),
    actorId: uuid('actor_id').references(() => users.id),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    uniqueIndex('one_open_demand')
      .on(t.storeId, t.demandKey)
      .where(sql`${t.status} = 'open'`),
    foreignKey({
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    foreignKey({
      columns: [t.storeId, t.supplierId],
      foreignColumns: [suppliers.storeId, suppliers.id],
    }),
    check('restock_values', sql`${t.requestCount} > 0 AND ${t.status} IN ('open','procured')`),
  ],
).enableRLS();
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: pk(),
    storeId: store(),
    productId: uuid('product_id').notNull(),
    delta: integer('delta').notNull(),
    kind: text('kind').notNull(),
    saleItemId: uuid('sale_item_id'),
    restockRequestId: uuid('restock_request_id'),
    reason: text('reason'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    unique().on(t.storeId, t.saleItemId),
    foreignKey({
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    foreignKey({
      columns: [t.storeId, t.saleItemId],
      foreignColumns: [saleItems.storeId, saleItems.id],
    }),
    foreignKey({
      columns: [t.storeId, t.restockRequestId],
      foreignColumns: [restockRequests.storeId, restockRequests.id],
    }),
    check(
      'movement_values',
      sql`${t.delta} <> 0 AND ${t.kind} IN ('opening','sale','receipt','adjustment') AND (${t.kind} <> 'adjustment' OR length(${t.reason}) > 0)`,
    ),
  ],
).enableRLS();
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    storeId: store(),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').notNull(),
    createdAt: time(),
  },
  (t) => [unique().on(t.storeId, t.operation, t.key)],
).enableRLS();
export const receiptLinks = pgTable(
  'receipt_links',
  {
    id: pk(),
    storeId: store(),
    saleId: uuid('sale_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    createdAt: time(),
  },
  (t) => [
    foreignKey({ columns: [t.storeId, t.saleId], foreignColumns: [sales.storeId, sales.id] }),
    index('receipt_expiry').on(t.expiresAt),
  ],
).enableRLS();
