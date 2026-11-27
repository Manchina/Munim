import { normalize, type Product, type Settings, type Customer, type Page } from '@munim/contracts';
import type { Connection } from '@munim/db';
import { one, fail } from '../../lib/core';
export const productSelect = `SELECT p.*, b.quantity, COALESCE((SELECT array_agg(a.alias ORDER BY a.alias) FROM product_aliases a WHERE a.store_id=p.store_id AND a.product_id=p.id),'{}') AS aliases FROM products p JOIN inventory_balances b ON b.store_id=p.store_id AND b.product_id=p.id`;
export const customerSelect = `SELECT c.*, COALESCE((SELECT array_agg(a.alias ORDER BY a.alias) FROM customer_aliases a WHERE a.store_id=c.store_id AND a.customer_id=c.id),'{}') AS aliases FROM customers c`;
export const settings = (db: Connection, storeId: string, lock = false) =>
  one<Settings>(db, `SELECT * FROM stores WHERE id=$1${lock ? ' FOR SHARE' : ''}`, [storeId]);
export const product = (db: Connection, storeId: string, id: string, lock = false) =>
  one<Product>(
    db,
    `${productSelect} WHERE p.store_id=$1 AND p.id=$2 AND p.archived_at IS NULL${lock ? ' FOR UPDATE OF p,b' : ''}`,
    [storeId, id],
  );
export const customer = (db: Connection, storeId: string, id: string, lock = false) =>
  one<Customer>(
    db,
    `${customerSelect} WHERE c.store_id=$1 AND c.id=$2 AND c.archived_at IS NULL${lock ? ' FOR UPDATE OF c' : ''}`,
    [storeId, id],
  );
export async function requireSupplier(db: Connection, storeId: string, id: string | null) {
  if (id)
    await one(db, 'SELECT id FROM suppliers WHERE store_id=$1 AND id=$2 AND archived_at IS NULL', [
      storeId,
      id,
    ]);
}
export async function aliases(
  db: Connection,
  table: 'product' | 'customer',
  storeId: string,
  id: string,
  values: string[],
) {
  await db.query(`DELETE FROM ${table}_aliases WHERE store_id=$1 AND ${table}_id=$2`, [
    storeId,
    id,
  ]);
  for (const alias of new Set(values.map(normalize)))
    await db.query(`INSERT INTO ${table}_aliases(store_id,${table}_id,alias) VALUES($1,$2,$3)`, [
      storeId,
      id,
      alias,
    ]);
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
    await db.query(
      'UPDATE inventory_balances SET quantity=quantity+$3 WHERE store_id=$1 AND product_id=$2',
      [storeId, productId, delta],
    );
    await db.query(
      'INSERT INTO stock_movements(store_id,product_id,delta,kind,reason,actor_id,restock_request_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [storeId, productId, delta, kind, reason, actorId, restockId],
    );
  }
  return { productId, quantity: p.quantity + delta };
}
