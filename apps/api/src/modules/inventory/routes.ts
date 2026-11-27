import { schema, type Database } from '@munim/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { type StoreRoute, key, empty } from '../../lib/router';
import { receiptInput, adjustmentInput, pageInput } from '@munim/contracts';
import { productSelect, productsWithAliases, page, moveStock } from '../catalog/repository';
import { idempotent } from '../../lib/core';
export function registerInventoryRoutes(route: StoreRoute, db: Database) {
  route('GET', '/inventory', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    const { products } = schema;
    const items = await productsWithAliases(
      db,
      productSelect(db)
        .where(
          and(
            eq(products.storeId, c.storeId),
            isNull(products.archivedAt),
            p.cursor ? gt(products.id, p.cursor) : undefined,
          ),
        )
        .orderBy(products.id)
        .limit(p.limit + 1),
    );
    return page(
      items.map((item) => ({ ...item, lowStock: item.quantity <= item.safetyStock })),
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
