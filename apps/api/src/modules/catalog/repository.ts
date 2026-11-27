import { normalize, type Product, type Settings, type Customer, type Page } from '@munim/contracts';
import { schema, type Connection } from '@munim/db';
import { and, eq, getTableColumns, inArray, isNull, type SQL } from 'drizzle-orm';
import { one, rows, fail } from '../../lib/core';

const {
  products,
  inventoryBalances,
  productAliases,
  customers,
  customerAliases,
  stores,
  suppliers,
  stockMovements,
} = schema;
export function productSelect(db: Connection) {
  return db
    .select({ ...getTableColumns(products), quantity: inventoryBalances.quantity })
    .from(products)
    .innerJoin(
      inventoryBalances,
      and(
        eq(inventoryBalances.storeId, products.storeId),
        eq(inventoryBalances.productId, products.id),
      ),
    );
}
export async function productsWithAliases(
  db: Connection,
  query: PromiseLike<(typeof products.$inferSelect & { quantity: number })[]>,
): Promise<Product[]> {
  const items = await rows(query);
  if (!items.length) return [];
  const aliases = await db
    .select()
    .from(productAliases)
    .where(
      and(
        eq(productAliases.storeId, items[0]!.storeId),
        inArray(
          productAliases.productId,
          items.map((p) => p.id),
        ),
      ),
    )
    .orderBy(productAliases.alias);
  return items.map((p) => ({
    ...p,
    aliases: aliases.filter((a) => a.productId === p.id).map((a) => a.alias),
  }));
}
export async function customersWithAliases(
  db: Connection,
  condition: SQL,
  limit?: number,
): Promise<Customer[]> {
  const query = db.select().from(customers).where(condition).orderBy(customers.id).$dynamic();
  const items = await rows(limit === undefined ? query : query.limit(limit));
  if (!items.length) return [];
  const aliases = await db
    .select()
    .from(customerAliases)
    .where(
      and(
        eq(customerAliases.storeId, items[0]!.storeId),
        inArray(
          customerAliases.customerId,
          items.map((c) => c.id),
        ),
      ),
    )
    .orderBy(customerAliases.alias);
  return items.map((c) => ({
    ...c,
    aliases: aliases.filter((a) => a.customerId === c.id).map((a) => a.alias),
  }));
}
export async function settings(db: Connection, storeId: string, lock = false): Promise<Settings> {
  const query = db.select().from(stores).where(eq(stores.id, storeId));
  return one(lock ? query.for('share') : query);
}
export async function product(
  db: Connection,
  storeId: string,
  id: string,
  lock = false,
): Promise<Product> {
  const query = productSelect(db).where(
    and(eq(products.storeId, storeId), eq(products.id, id), isNull(products.archivedAt)),
  );
  const items = await productsWithAliases(
    db,
    lock ? query.for('update', { of: [products, inventoryBalances] }) : query,
  );
  return items[0] ?? fail(404, 'NOT_FOUND', 'Resource was not found.');
}
export async function customer(
  db: Connection,
  storeId: string,
  id: string,
  lock = false,
): Promise<Customer> {
  const condition = and(
    eq(customers.storeId, storeId),
    eq(customers.id, id),
    isNull(customers.archivedAt),
  )!;
  if (lock)
    await one(db.select({ id: customers.id }).from(customers).where(condition).for('update'));
  const items = await customersWithAliases(db, condition);
  return items[0] ?? fail(404, 'NOT_FOUND', 'Resource was not found.');
}
export async function requireSupplier(db: Connection, storeId: string, id: string | null) {
  if (id)
    await one(
      db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(eq(suppliers.storeId, storeId), eq(suppliers.id, id), isNull(suppliers.archivedAt)),
        ),
    );
}
export async function aliases(
  db: Connection,
  table: 'product' | 'customer',
  storeId: string,
  id: string,
  values: string[],
) {
  const unique = [...new Set(values.map(normalize))];
  if (table === 'product') {
    await db
      .delete(productAliases)
      .where(and(eq(productAliases.storeId, storeId), eq(productAliases.productId, id)));
    if (unique.length)
      await db
        .insert(productAliases)
        .values(unique.map((alias) => ({ storeId, productId: id, alias })));
  } else {
    await db
      .delete(customerAliases)
      .where(and(eq(customerAliases.storeId, storeId), eq(customerAliases.customerId, id)));
    if (unique.length)
      await db
        .insert(customerAliases)
        .values(unique.map((alias) => ({ storeId, customerId: id, alias })));
  }
}
export function page<T extends { id: string }>(items: T[], limit: number): Page<T> {
  return {
    items: items.slice(0, limit),
    nextCursor: items.length > limit ? items[limit - 1]!.id : null,
  };
}
export async function moveStock(
  db: Connection,
  storeId: string,
  actorId: string,
  productId: string,
  delta: number,
  kind: 'opening' | 'receipt' | 'adjustment',
  reason: string | null = null,
  restockId: string | null = null,
) {
  const p = await product(db, storeId, productId, true);
  if (p.quantity + delta < 0 || p.quantity + delta > 2_000_000_000)
    fail(422, 'INVALID_STOCK', 'Stock would be outside the supported range.');
  if (delta) {
    await db
      .update(inventoryBalances)
      .set({ quantity: p.quantity + delta })
      .where(
        and(eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.productId, productId)),
      );
    await db
      .insert(stockMovements)
      .values({ storeId, productId, delta, kind, reason, actorId, restockRequestId: restockId });
  }
  return { productId, quantity: p.quantity + delta };
}
