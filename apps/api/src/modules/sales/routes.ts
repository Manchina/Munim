import { schema, type Database } from '@munim/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type StoreRoute, param, key, empty } from '../../lib/router';
import { cartInput, checkoutInput, pageInput } from '@munim/contracts';
import { page } from '../catalog/repository';
import { preview, checkout, saleDetail } from './service';
import { rows } from '../../lib/core';
const { sales } = schema;
export function registerSalesRoutes(route: StoreRoute, db: Database, secret: string) {
  route('POST', '/sales/preview', cartInput, async (v, c) =>
    preview(db, c.storeId, c.userId, v, secret),
  );
  route('POST', '/sales', checkoutInput, async (v, c, req) =>
    checkout(db, c.storeId, c.userId, v, key(req), secret),
  );
  route('GET', '/sales', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    const cursor = alias(sales, 'cursor_sale');
    const cursorTime = p.cursor
      ? db
          .select({ createdAt: cursor.createdAt })
          .from(cursor)
          .where(and(eq(cursor.storeId, c.storeId), eq(cursor.id, p.cursor)))
      : undefined;
    return page(
      await rows(
        db
          .select()
          .from(sales)
          .where(
            and(
              eq(sales.storeId, c.storeId),
              p.cursor && cursorTime
                ? or(
                    lt(sales.createdAt, cursorTime),
                    and(eq(sales.createdAt, cursorTime), lt(sales.id, p.cursor)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(sales.createdAt), desc(sales.id))
          .limit(p.limit + 1),
      ),
      p.limit,
    );
  });
  route('GET', '/sales/:saleId', empty, async (_, c, req) =>
    saleDetail(db, c.storeId, param(req, 'saleId')),
  );
}
