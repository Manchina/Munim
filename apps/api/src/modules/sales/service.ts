import { z } from 'zod';
import {
  cartInput,
  lineTotal,
  sumMoney,
  type CartInput,
  type Sale,
  type SaleLine,
  type Preview,
  type Settings,
} from '@munim/contracts';
import type { Connection, Database } from '@munim/db';
import { customer, product, settings } from '../catalog/repository';
import { canonical, fail, hash, idempotent, one, rows, sign, verify } from '../../lib/core';
const quoteSchema = z.object({
  storeId: z.string().uuid(),
  userId: z.string().uuid(),
  cart: cartInput,
  fingerprint: z.string(),
  expiresAt: z.number(),
});
function boundedMoney(calculate: () => number): number {
  try {
    return calculate();
  } catch {
    return fail(422, 'AMOUNT_LIMIT', 'Amount exceeds the supported limit.');
  }
}
async function calculate(db: Connection, storeId: string, cart: CartInput, lock: boolean) {
  const store = await settings(db, storeId, lock);
  if (cart.customerId) await customer(db, storeId, cart.customerId, lock);
  const combined = new Map<string, number>();
  for (const i of cart.items)
    combined.set(i.productId, (combined.get(i.productId) ?? 0) + i.quantity);
  const items: SaleLine[] = [],
    lowStock: string[] = [],
    versions: number[] = [];
  for (const [productId, quantity] of [...combined].sort(([a], [b]) => a.localeCompare(b))) {
    if (quantity > 2_000_000_000) fail(422, 'QUANTITY_LIMIT', 'Quantity is too large.');
    const p = await product(db, storeId, productId, lock);
    if (quantity > p.quantity) fail(409, 'INSUFFICIENT_STOCK', `Not enough stock for ${p.name}.`);
    items.push({
      productId,
      quantity,
      name: p.name,
      variant: p.variant,
      baseUnit: p.baseUnit,
      priceQuantity: p.priceQuantity,
      pricePaise: p.pricePaise,
      lineTotalPaise: boundedMoney(() => lineTotal(p.pricePaise, quantity, p.priceQuantity)),
    });
    versions.push(p.version);
    if (p.quantity > p.safetyStock && p.quantity - quantity <= p.safetyStock) lowStock.push(p.name);
  }
  const totalPaise = boundedMoney(() => sumMoney(items.map((i) => i.lineTotalPaise)));
  if (cart.paymentMethod === 'credit' && totalPaise === 0)
    fail(422, 'ZERO_CREDIT', 'A credit sale must have a positive total.');
  if (cart.paymentMethod === 'upi' && !store.upiPayee)
    fail(422, 'UPI_NOT_CONFIGURED', 'Configure a UPI payee before using UPI checkout.');
  return {
    store,
    items,
    totalPaise,
    lowStock,
    fingerprint: hash(canonical({ items, versions, settingsVersion: store.settingsVersion })),
  };
}
export async function preview(
  db: Connection,
  storeId: string,
  userId: string,
  cart: CartInput,
  secret: string,
): Promise<Preview> {
  const value = await calculate(db, storeId, cart, false);
  const expiresAt = Date.now() + 300000;
  return {
    items: value.items,
    totalPaise: value.totalPaise,
    requiresCreditConfirmation:
      cart.paymentMethod === 'credit' &&
      value.totalPaise > value.store.creditConfirmationThresholdPaise,
    expiresAt,
    quote: sign({ storeId, userId, cart, fingerprint: value.fingerprint, expiresAt }, secret),
  };
}
export async function checkout(
  db: Database,
  storeId: string,
  userId: string,
  input: { quote: string; confirmed: true },
  key: string | undefined,
  secret: string,
): Promise<Sale> {
  return idempotent(db, storeId, 'checkout', key, input, async (tx) => {
    const parsed = quoteSchema.safeParse(verify(input.quote, secret));
    if (!parsed.success) return fail(422, 'INVALID_QUOTE', 'Request a new preview.');
    const q = parsed.data;
    if (q.storeId !== storeId || q.userId !== userId)
      fail(403, 'QUOTE_ACCESS', 'This quote belongs to another session context.');
    if (q.expiresAt < Date.now()) fail(409, 'QUOTE_EXPIRED', 'Request a new preview.');
    const value = await calculate(tx, storeId, q.cart, true);
    if (value.fingerprint !== q.fingerprint)
      fail(409, 'QUOTE_CHANGED', 'Prices or settings changed. Review a new preview.');
    if (q.cart.paymentMethod === 'credit') {
      const balance = await customerBalance(tx, storeId, q.cart.customerId!);
      boundedMoney(() => sumMoney([balance, value.totalPaise]));
    }
    const sale = await one<Sale>(
      tx,
      'INSERT INTO sales(store_id,customer_id,payment_method,total_paise,actor_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [storeId, q.cart.customerId, q.cart.paymentMethod, value.totalPaise, userId],
    );
    for (const i of value.items) {
      const line = await one<{ id: string }>(
        tx,
        'INSERT INTO sale_items(store_id,sale_id,product_id,name,variant,base_unit,quantity,price_quantity,price_paise,line_total_paise) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        [
          storeId,
          sale.id,
          i.productId,
          i.name,
          i.variant,
          i.baseUnit,
          i.quantity,
          i.priceQuantity,
          i.pricePaise,
          i.lineTotalPaise,
        ],
      );
      await tx.query(
        'UPDATE inventory_balances SET quantity=quantity-$3 WHERE store_id=$1 AND product_id=$2',
        [storeId, i.productId, i.quantity],
      );
      await tx.query(
        "INSERT INTO stock_movements(store_id,product_id,delta,kind,sale_item_id,actor_id) VALUES($1,$2,$3,'sale',$4,$5)",
        [storeId, i.productId, -i.quantity, line.id, userId],
      );
    }
    if (q.cart.paymentMethod === 'credit')
      await tx.query(
        "INSERT INTO khata_entries(store_id,customer_id,kind,amount_paise,sale_id,actor_id) VALUES($1,$2,'sale_debit',$3,$4,$5)",
        [storeId, q.cart.customerId, value.totalPaise, sale.id, userId],
      );
    return { ...sale, items: value.items, lowStock: value.lowStock };
  });
}
export async function customerBalance(
  db: Connection,
  storeId: string,
  customerId: string,
): Promise<number> {
  const r = await one<{ balancePaise: number }>(
    db,
    "SELECT COALESCE(SUM(CASE WHEN kind='sale_debit' THEN amount_paise ELSE -amount_paise END),0)::bigint AS balance_paise FROM khata_entries WHERE store_id=$1 AND customer_id=$2",
    [storeId, customerId],
  );
  return r.balancePaise;
}
export async function saleDetail(db: Connection, storeId: string, saleId: string): Promise<Sale> {
  const sale = await one<Sale>(db, 'SELECT * FROM sales WHERE store_id=$1 AND id=$2', [
    storeId,
    saleId,
  ]);
  const items = await rows<SaleLine>(
    db,
    'SELECT product_id,name,variant,base_unit,quantity,price_quantity,price_paise,line_total_paise FROM sale_items WHERE store_id=$1 AND sale_id=$2 ORDER BY id',
    [storeId, saleId],
  );
  return { ...sale, items };
}
export function publicReceipt(sale: Sale, store: Settings) {
  return {
    storeName: store.name,
    createdAt: sale.createdAt,
    totalPaise: sale.totalPaise,
    paymentStatus:
      sale.paymentMethod === 'credit' ? 'credit_at_checkout' : 'merchant_confirmed_paid',
    items: sale.items?.map(({ productId: _, ...item }) => item),
  };
}
