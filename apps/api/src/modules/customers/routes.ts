import { schema, type Database } from '@munim/db';
import { and, eq, gt, ilike, isNull } from 'drizzle-orm';
import { type StoreRoute, param, empty } from '../../lib/router';
import { personInput, pageInput, normalize } from '@munim/contracts';
import { customer, customersWithAliases, aliases, page } from '../catalog/repository';
import { customerBalance } from '../sales/service';
import { one, fail } from '../../lib/core';
const { customers } = schema;
export function registerCustomersRoutes(route: StoreRoute, db: Database) {
  route('GET', '/customers', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await customersWithAliases(
        db,
        and(
          eq(customers.storeId, c.storeId),
          isNull(customers.archivedAt),
          p.cursor ? gt(customers.id, p.cursor) : undefined,
          ilike(customers.name, `%${normalize(p.q)}%`),
        )!,
        p.limit + 1,
      ),
      p.limit,
    );
  });
  route('GET', '/customers/:customerId', empty, async (_, c, req) =>
    customer(db, c.storeId, param(req, 'customerId')),
  );
  route('POST', '/customers', personInput, async (v, c) =>
    db.transaction(async (tx) => {
      const p = await one(
        tx
          .insert(customers)
          .values({ storeId: c.storeId, name: v.name, phone: v.phone })
          .returning({ id: customers.id }),
      );
      await aliases(tx, 'customer', c.storeId, p.id, v.aliases);
      return customer(tx, c.storeId, p.id);
    }),
  );
  route('PATCH', '/customers/:customerId', personInput, async (v, c, req) =>
    db.transaction(async (tx) => {
      const customerId = param(req, 'customerId');
      await customer(tx, c.storeId, customerId, true);
      if (v.archived && (await customerBalance(tx, c.storeId, customerId)) !== 0)
        fail(422, 'PENDING_BALANCE', 'Settle this balance before archiving.');
      await tx
        .update(customers)
        .set({ name: v.name, phone: v.phone, archivedAt: v.archived ? new Date() : null })
        .where(and(eq(customers.storeId, c.storeId), eq(customers.id, customerId)));
      await aliases(tx, 'customer', c.storeId, customerId, v.aliases);
      return { id: customerId };
    }),
  );
}
