import type { Database } from '@munim/db';
import { type StoreRoute, key, empty } from '../../lib/router';
import { receiptInput, adjustmentInput, pageInput, type Product } from '@munim/contracts';
import { productSelect, page, moveStock } from '../catalog/repository';
import { rows, idempotent } from '../../lib/core';
export function registerInventoryRoutes(route: StoreRoute, db: Database) {
  route('GET', '/inventory', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<Product & { lowStock: boolean }>(
        db,
        `${productSelect.replace('SELECT p.*,', 'SELECT p.*, b.quantity<=p.safety_stock AS low_stock,')} WHERE p.store_id=$1 AND p.archived_at IS NULL AND ($2::uuid IS NULL OR p.id>$2) ORDER BY p.id LIMIT $3`,
        [c.storeId, p.cursor ?? null, p.limit + 1],
      ),
      p.limit,
    );
  });
  route('POST', '/inventory/receipts', receiptInput, async (v, c, req) =>
    idempotent(db, c.storeId, 'stock-receipt', key(req), v, async (tx) => {
      const result = [];
      for (const i of [...v.items].sort((a, b) => a.productId.localeCompare(b.productId)))
        result.push(await moveStock(tx, c.storeId, c.userId, i.productId, i.quantity, 'receipt'));
      return { items: result };
    }),
  );
  route(
    'POST',
    '/inventory/adjustments',
    adjustmentInput,
    async (v, c, req) =>
      idempotent(db, c.storeId, 'stock-adjustment', key(req), v, (tx) =>
        moveStock(tx, c.storeId, c.userId, v.productId, v.delta, 'adjustment', v.reason),
      ),
    true,
  );
}
