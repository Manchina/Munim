import type { Database } from '@munim/db';
import { type StoreRoute, param, key, empty } from '../../lib/router';
import { cartInput, checkoutInput, pageInput, type Sale } from '@munim/contracts';
import { page } from '../catalog/repository';
import { preview, checkout, saleDetail } from './service';
import { rows } from '../../lib/core';
export function registerSalesRoutes(route: StoreRoute, db: Database, secret: string) {
  route('POST', '/sales/preview', cartInput, async (v, c) =>
    preview(db, c.storeId, c.userId, v, secret),
  );
  route('POST', '/sales', checkoutInput, async (v, c, req) =>
    checkout(db, c.storeId, c.userId, v, key(req), secret),
  );
  route('GET', '/sales', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<Sale>(
        db,
        'SELECT * FROM sales WHERE store_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM sales WHERE store_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT $3',
        [c.storeId, p.cursor ?? null, p.limit + 1],
      ),
      p.limit,
    );
  });
  route('GET', '/sales/:saleId', empty, async (_, c, req) =>
    saleDetail(db, c.storeId, param(req, 'saleId')),
  );
}
