import { schema, type Database } from '@munim/db';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type StoreRoute, param, key, empty } from '../../lib/router';
import { pageInput, paymentInput } from '@munim/contracts';
import { customer, page } from '../catalog/repository';
import { balanceExpression, customerBalance } from '../sales/service';
import { one, rows, fail, idempotent } from '../../lib/core';
const { customers, khataEntries } = schema;
export function registerKhataRoutes(route: StoreRoute, db: Database) {
  route('GET', '/khata', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows(
        db
          .select({ id: customers.id, name: customers.name, balancePaise: balanceExpression() })
          .from(customers)
          .leftJoin(
            khataEntries,
            and(
              eq(khataEntries.storeId, customers.storeId),
              eq(khataEntries.customerId, customers.id),
            ),
          )
          .where(
            and(
              eq(customers.storeId, c.storeId),
              isNull(customers.archivedAt),
              p.cursor ? gt(customers.id, p.cursor) : undefined,
            ),
          )
          .groupBy(customers.id)
          .orderBy(customers.id)
          .limit(p.limit + 1),
      ),
      p.limit,
    );
  });
  route('GET', '/customers/:customerId/khata', empty, async (_, c, req) => {
    const customerId = param(req, 'customerId');
    await customer(db, c.storeId, customerId);
    const p = pageInput.parse(req.query);
    const cursor = alias(khataEntries, 'cursor_entry');
    const cursorTime = p.cursor
      ? db
          .select({ createdAt: cursor.createdAt })
          .from(cursor)
          .where(
            and(
              eq(cursor.storeId, c.storeId),
              eq(cursor.customerId, customerId),
              eq(cursor.id, p.cursor),
            ),
          )
      : undefined;
    const entries = await rows(
      db
        .select()
        .from(khataEntries)
        .where(
          and(
            eq(khataEntries.storeId, c.storeId),
            eq(khataEntries.customerId, customerId),
            p.cursor && cursorTime
              ? or(
                  lt(khataEntries.createdAt, cursorTime),
                  and(eq(khataEntries.createdAt, cursorTime), lt(khataEntries.id, p.cursor)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(khataEntries.createdAt), desc(khataEntries.id))
        .limit(p.limit + 1),
    );
    return {
      balancePaise: await customerBalance(db, c.storeId, customerId),
      ...page(entries, p.limit),
    };
  });
  route('POST', '/customers/:customerId/payments', paymentInput, async (v, c, req) => {
    const customerId = param(req, 'customerId');
    return idempotent(db, c.storeId, `payment:${customerId}`, key(req), v, async (tx) => {
      await customer(tx, c.storeId, customerId, true);
      const balance = await customerBalance(tx, c.storeId, customerId);
      if (v.amountPaise > balance) fail(422, 'OVERPAYMENT', 'Payment exceeds the pending balance.');
      const entry = await one(
        tx
          .insert(khataEntries)
          .values({
            storeId: c.storeId,
            customerId,
            kind: 'payment',
            amountPaise: v.amountPaise,
            method: v.method,
            reference: v.reference,
            actorId: c.userId,
          })
          .returning(),
      );
      return { entry, balancePaise: balance - v.amountPaise };
    });
  });
}
