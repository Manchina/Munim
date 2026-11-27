import { and, eq, sql } from 'drizzle-orm';
import { schema, type Database } from './index';
const {
  users,
  stores,
  memberships,
  products,
  inventoryBalances,
  stockMovements,
  productAliases,
  customers,
  customerAliases,
  sales,
  saleItems,
  khataEntries,
} = schema;
export async function seedDemo(db: Database, email: string, passwordHash: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: email.toLowerCase(), passwordHash })
      .returning({ id: users.id });
    const [store] = await tx
      .insert(stores)
      .values({ name: 'Munim Demo Kirana' })
      .returning({ id: stores.id });
    if (!user || !store) throw new Error('Unable to create demo owner and store.');
    await tx.insert(memberships).values({ storeId: store.id, userId: user.id, role: 'owner' });
    const data: [string, string, 'gram' | 'each', number, number, number, string[]][] = [
      ['Toor dal', '', 'gram', 12000, 6000, 5000, ['toor dal', 'arhar dal']],
      ['Chana dal', '', 'gram', 9000, 20000, 4000, ['chana dal']],
      ['Rice', '', 'gram', 7000, 40000, 10000, ['rice', 'chawal']],
      ['Sugar', '', 'gram', 4500, 25000, 5000, ['sugar', 'shakkar']],
      ['Atta', '', 'gram', 4200, 30000, 5000, ['atta']],
      ['Salt', '1 kg packet', 'each', 2500, 30, 5, ['salt', 'namak']],
      ['Cooking oil', '1 litre pouch', 'each', 15000, 20, 5, ['oil', 'cooking oil']],
      ['Tea', '250 g packet', 'each', 12000, 20, 4, ['tea', 'chai']],
      ['Milk', '500 ml pouch', 'each', 3000, 30, 5, ['milk', 'doodh']],
      ['Lifebuoy', '100 g soap', 'each', 3500, 24, 5, ['lifebuoy sabun', 'sabun', 'lifebuoy']],
      ['Bread', '400 g packet', 'each', 4500, 6, 5, ['bread', 'bread packet']],
      ['Biscuits', '100 g packet', 'each', 2000, 30, 5, ['biscuits', 'biscuit']],
    ];
    const productIds: Record<string, string> = {};
    for (const [name, variant, baseUnit, pricePaise, stock, safetyStock, aliases] of data) {
      const [p] = await tx
        .insert(products)
        .values({
          storeId: store.id,
          name,
          normalizedName: name.toLowerCase(),
          variant,
          baseUnit,
          priceQuantity: baseUnit === 'gram' ? 1000 : 1,
          pricePaise,
          safetyStock,
        })
        .returning({ id: products.id });
      if (!p) throw new Error('Unable to create demo product.');
      productIds[name] = p.id;
      await tx
        .insert(inventoryBalances)
        .values({ storeId: store.id, productId: p.id, quantity: stock });
      await tx.insert(stockMovements).values({
        storeId: store.id,
        productId: p.id,
        delta: stock,
        kind: 'opening',
        actorId: user.id,
      });
      await tx
        .insert(productAliases)
        .values(aliases.map((alias) => ({ storeId: store.id, productId: p.id, alias })));
    }
    const customerIds: Record<string, string> = {};
    const createdAt = new Date(Date.now() - 86400000);
    for (const [name, productName, qty, total] of [
      ['Ramesh', 'Rice', 2000, 14000],
      ['Sita', 'Tea', 1, 12000],
    ] as const) {
      const [customer] = await tx
        .insert(customers)
        .values({ storeId: store.id, name })
        .returning({ id: customers.id });
      if (!customer) throw new Error('Unable to create demo customer.');
      customerIds[name] = customer.id;
      await tx
        .insert(customerAliases)
        .values({ storeId: store.id, customerId: customer.id, alias: name.toLowerCase() });
      const [sale] = await tx
        .insert(sales)
        .values({
          storeId: store.id,
          customerId: customer.id,
          paymentMethod: 'credit',
          totalPaise: total,
          actorId: user.id,
          createdAt,
        })
        .returning({ id: sales.id });
      const p = data.find((d) => d[0] === productName)!;
      if (!sale) throw new Error('Unable to create demo sale.');
      const [line] = await tx
        .insert(saleItems)
        .values({
          storeId: store.id,
          saleId: sale.id,
          productId: productIds[productName]!,
          name: p[0],
          variant: p[1],
          baseUnit: p[2],
          quantity: qty,
          priceQuantity: p[2] === 'gram' ? 1000 : 1,
          pricePaise: p[3],
          lineTotalPaise: total,
        })
        .returning({ id: saleItems.id });
      if (!line) throw new Error('Unable to create demo sale item.');
      await tx
        .update(inventoryBalances)
        .set({ quantity: sql`${inventoryBalances.quantity} - ${qty}` })
        .where(
          and(
            eq(inventoryBalances.storeId, store.id),
            eq(inventoryBalances.productId, productIds[productName]!),
          ),
        );
      await tx.insert(stockMovements).values({
        storeId: store.id,
        productId: productIds[productName]!,
        delta: -qty,
        kind: 'sale',
        saleItemId: line.id,
        actorId: user.id,
        createdAt,
      });
      await tx.insert(khataEntries).values({
        storeId: store.id,
        customerId: customer.id,
        kind: 'sale_debit',
        amountPaise: total,
        saleId: sale.id,
        actorId: user.id,
        createdAt,
      });
    }
    return { userId: user.id, storeId: store.id, products: productIds, customers: customerIds };
  });
}
