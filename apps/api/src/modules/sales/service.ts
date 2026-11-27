import { z } from 'zod';
import { and, eq, sql, getTableColumns } from 'drizzle-orm';
import { schema, type Connection, type Database } from '@munim/db';
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
import { customer, product, settings } from '../catalog/repository';
import { canonical, fail, hash, idempotent, one, rows, sign, verify } from '../../lib/core';
const { sales, saleItems, inventoryBalances, stockMovements, khataEntries } = schema;
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
    const sale = await one(
      tx
        .insert(sales)
        .values({
          storeId,
          customerId: q.cart.customerId,
          paymentMethod: q.cart.paymentMethod,
          totalPaise: value.totalPaise,
          actorId: userId,
        })
        .returning(),
    );
    for (const i of value.items) {
      const line = await one(
        tx
          .insert(saleItems)
          .values({ storeId, saleId: sale.id, ...i })
          .returning({ id: saleItems.id }),
      );
      await tx
        .update(inventoryBalances)
        .set({ quantity: sql`${inventoryBalances.quantity} - ${i.quantity}` })
        .where(
          and(eq(inventoryBalances.storeId, storeId), eq(inventoryBalances.productId, i.productId)),
        );
      await tx.insert(stockMovements).values({
        storeId,
        productId: i.productId,
        delta: -i.quantity,
        kind: 'sale',
        saleItemId: line.id,
        actorId: userId,
      });
    }
    if (q.cart.paymentMethod === 'credit')
      await tx.insert(khataEntries).values({
        storeId,
        customerId: q.cart.customerId!,
        kind: 'sale_debit',
        amountPaise: value.totalPaise,
        saleId: sale.id,
        actorId: userId,
      });
    return { ...sale, items: value.items, lowStock: value.lowStock };
  });
}
// PostgreSQL performs the aggregate exactly; the API boundary rejects unsafe numeric results.
export const balanceExpression = () =>
  sql<number>`coalesce(sum(case when ${khataEntries.kind} = 'sale_debit' then ${khataEntries.amountPaise} else -${khataEntries.amountPaise} end), 0)::bigint`.mapWith(
    Number,
  );
export async function customerBalance(
  db: Connection,
  storeId: string,
  customerId: string,
): Promise<number> {
  const r = await one(
    db
      .select({ balancePaise: balanceExpression() })
      .from(khataEntries)
      .where(and(eq(khataEntries.storeId, storeId), eq(khataEntries.customerId, customerId))),
  );
  return r.balancePaise;
}
export async function saleDetail(db: Connection, storeId: string, saleId: string): Promise<Sale> {
  const sale = await one(
    db
      .select()
      .from(sales)
      .where(and(eq(sales.storeId, storeId), eq(sales.id, saleId))),
  );
  const { id: _id, storeId: _storeId, saleId: _saleId, ...fields } = getTableColumns(saleItems);
  const items = await rows(
    db
      .select(fields)
      .from(saleItems)
      .where(and(eq(saleItems.storeId, storeId), eq(saleItems.saleId, saleId)))
      .orderBy(saleItems.id),
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
