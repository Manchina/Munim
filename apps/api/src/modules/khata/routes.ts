import type { Database } from '@munim/db';
import { type StoreRoute, param, key, empty } from '../../lib/router';
import { pageInput, paymentInput, type LedgerEntry } from '@munim/contracts';
import { customer, page } from '../catalog/repository';
import { customerBalance } from '../sales/service';
import { one, rows, fail, idempotent } from '../../lib/core';
export function registerKhataRoutes(route: StoreRoute, db: Database) {
  route('GET', '/khata', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<{ id: string; name: string; balancePaise: number }>(
        db,
        "SELECT c.id,c.name,COALESCE(SUM(CASE WHEN k.kind='sale_debit' THEN k.amount_paise ELSE -k.amount_paise END),0)::bigint AS balance_paise FROM customers c LEFT JOIN khata_entries k ON k.store_id=c.store_id AND k.customer_id=c.id WHERE c.store_id=$1 AND c.archived_at IS NULL AND ($2::uuid IS NULL OR c.id>$2) GROUP BY c.id ORDER BY c.id LIMIT $3",
        [c.storeId, p.cursor ?? null, p.limit + 1],
      ),
      p.limit,
    );
  });
  route('GET', '/customers/:customerId/khata', empty, async (_, c, req) => {
    const customerId = param(req, 'customerId');
    await customer(db, c.storeId, customerId);
    const p = pageInput.parse(req.query);
    const entries = await rows<LedgerEntry>(
      db,
      'SELECT * FROM khata_entries WHERE store_id=$1 AND customer_id=$2 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM khata_entries WHERE store_id=$1 AND customer_id=$2 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT $4',
      [c.storeId, customerId, p.cursor ?? null, p.limit + 1],
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
      const entry = await one<LedgerEntry>(
        tx,
        "INSERT INTO khata_entries(store_id,customer_id,kind,amount_paise,method,reference,actor_id) VALUES($1,$2,'payment',$3,$4,$5,$6) RETURNING *",
        [c.storeId, customerId, v.amountPaise, v.method, v.reference, c.userId],
      );
      return { entry, balancePaise: balance - v.amountPaise };
    });
  });
}
