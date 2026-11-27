import type { Database } from '@munim/db';
import { type StoreRoute, param, key, empty } from '../../lib/router';
import {
  restockInput,
  procurementInput,
  pageInput,
  normalize,
  type Restock,
} from '@munim/contracts';
import { product, requireSupplier, page, moveStock } from '../catalog/repository';
import { one, rows, fail, idempotent } from '../../lib/core';
export function registerRestockRoutes(route: StoreRoute, db: Database) {
  route('GET', '/restock-requests', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<Restock>(
        db,
        'SELECT * FROM restock_requests WHERE store_id=$1 AND status=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4',
        [c.storeId, p.status, p.cursor ?? null, p.limit + 1],
      ),
      p.limit,
    );
  });
  route('POST', '/restock-requests', restockInput, async (v, c, req) =>
    idempotent(db, c.storeId, 'restock', key(req), v, async (tx) => {
      const p = v.productId ? await product(tx, c.storeId, v.productId) : null;
      const supplierId = p?.supplierId ?? v.supplierId;
      await requireSupplier(tx, c.storeId, supplierId);
      const normalizeSize = (s: string) =>
        normalize(s)
          .replace(/(\d)\s+(kg|g|ml|l)\b/g, '$1$2')
          .replace(/(\d+(?:\.\d+)?)kg\b/g, (_, n: string) => `${Number(n) * 1000}g`)
          .replace(/(\d+(?:\.\d+)?)l\b/g, (_, n: string) => `${Number(n) * 1000}ml`);
      const demandKey = p
        ? `product:${p.id}`
        : `unknown:${normalizeSize(v.name)}:${normalizeSize(v.variant)}`;
      return one<Restock>(
        tx,
        "INSERT INTO restock_requests(store_id,product_id,name,variant,demand_key,supplier_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id,demand_key) WHERE status='open' DO UPDATE SET request_count=restock_requests.request_count+1,last_requested_at=now() RETURNING *",
        [
          c.storeId,
          p?.id ?? null,
          p?.name ?? v.name,
          p?.variant ?? v.variant,
          demandKey,
          supplierId,
        ],
      );
    }),
  );
  route('POST', '/restock-requests/:requestId/procure', procurementInput, async (v, c, req) => {
    const requestId = param(req, 'requestId');
    return idempotent(db, c.storeId, `procure:${requestId}`, key(req), v, async (tx) => {
      const request = await one<Restock>(
        tx,
        "SELECT * FROM restock_requests WHERE store_id=$1 AND id=$2 AND status='open' FOR UPDATE",
        [c.storeId, requestId],
      );
      if (v.quantityReceived && !request.productId)
        fail(422, 'CATALOG_REQUIRED', 'Create a catalog product before receiving stock.');
      if (v.quantityReceived)
        await moveStock(
          tx,
          c.storeId,
          c.userId,
          request.productId!,
          v.quantityReceived,
          'receipt',
          null,
          requestId,
        );
      return one(
        tx,
        "UPDATE restock_requests SET status='procured',procured_at=now(),actor_id=$3 WHERE store_id=$1 AND id=$2 RETURNING *",
        [c.storeId, requestId, c.userId],
      );
    });
  });
}
