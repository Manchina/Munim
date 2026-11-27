import type { Database } from '@munim/db';
import { type StoreRoute, param, empty } from '../../lib/router';
import { personInput, pageInput, normalize, type Customer } from '@munim/contracts';
import { customer, customerSelect, aliases, page } from '../catalog/repository';
import { customerBalance } from '../sales/service';
import { one, rows, fail } from '../../lib/core';
export function registerCustomersRoutes(route: StoreRoute, db: Database) {
  route('GET', '/customers', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<Customer>(
        db,
        `${customerSelect} WHERE c.store_id=$1 AND c.archived_at IS NULL AND ($2::uuid IS NULL OR c.id>$2) AND lower(c.name) LIKE '%'||$3||'%' ORDER BY c.id LIMIT $4`,
        [c.storeId, p.cursor ?? null, normalize(p.q), p.limit + 1],
      ),
      p.limit,
    );
  });
  route('GET', '/customers/:customerId', empty, async (_, c, req) =>
    customer(db, c.storeId, param(req, 'customerId')),
  );
  route('POST', '/customers', personInput, async (v, c) =>
    db.transaction(async (tx) => {
      const p = await one<{ id: string }>(
        tx,
        'INSERT INTO customers(store_id,name,phone) VALUES($1,$2,$3) RETURNING id',
        [c.storeId, v.name, v.phone],
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
      await tx.query(
        'UPDATE customers SET name=$3,phone=$4,archived_at=$5 WHERE store_id=$1 AND id=$2',
        [c.storeId, customerId, v.name, v.phone, v.archived ? new Date() : null],
      );
      await aliases(tx, 'customer', c.storeId, customerId, v.aliases);
      return { id: customerId };
    }),
  );
}
