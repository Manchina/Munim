import { schema, type Database } from '@munim/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { type StoreRoute, param, key, empty } from '../../lib/router';
import { restockInput, procurementInput, pageInput, normalize } from '@munim/contracts';
import { product, requireSupplier, page, moveStock } from '../catalog/repository';
import { one, rows, fail, idempotent } from '../../lib/core';
const { restockRequests } = schema;
export function registerRestockRoutes(route: StoreRoute, db: Database) {
  route('GET', '/restock-requests', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows(
        db
          .select()
          .from(restockRequests)
          .where(
            and(
              eq(restockRequests.storeId, c.storeId),
              eq(restockRequests.status, p.status),
              p.cursor ? gt(restockRequests.id, p.cursor) : undefined,
            ),
          )
          .orderBy(restockRequests.id)
          .limit(p.limit + 1),
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
      return one(
        tx
          .insert(restockRequests)
          .values({
            storeId: c.storeId,
            productId: p?.id ?? null,
            name: p?.name ?? v.name,
            variant: p?.variant ?? v.variant,
            demandKey,
            supplierId,
          })
          .onConflictDoUpdate({
            target: [restockRequests.storeId, restockRequests.demandKey],
            targetWhere: sql`${restockRequests.status} = 'open'`,
            set: {
              requestCount: sql`${restockRequests.requestCount} + 1`,
              lastRequestedAt: new Date(),
            },
          })
          .returning(),
      );
    }),
  );
  route('POST', '/restock-requests/:requestId/procure', procurementInput, async (v, c, req) => {
    const requestId = param(req, 'requestId');
    return idempotent(db, c.storeId, `procure:${requestId}`, key(req), v, async (tx) => {
      const request = await one(
        tx
          .select()
          .from(restockRequests)
          .where(
            and(
              eq(restockRequests.storeId, c.storeId),
              eq(restockRequests.id, requestId),
              eq(restockRequests.status, 'open'),
            ),
          )
          .for('update'),
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
        tx
          .update(restockRequests)
          .set({ status: 'procured', procuredAt: new Date(), actorId: c.userId })
          .where(and(eq(restockRequests.storeId, c.storeId), eq(restockRequests.id, requestId)))
          .returning(),
      );
    });
  });
}
