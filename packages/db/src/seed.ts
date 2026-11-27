import type { Database } from './index';
type RecordId = { id: string };
export async function seedDemo(db: Database, email: string, passwordHash: string) {
  return db.transaction(async (tx) => {
    const user = (
      await tx.query<RecordId>(
        'INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id',
        [email.toLowerCase(), passwordHash],
      )
    )[0]!;
    const store = (
      await tx.query<RecordId>("INSERT INTO stores(name) VALUES('Munim Demo Kirana') RETURNING id")
    )[0]!;
    await tx.query("INSERT INTO store_memberships(store_id,user_id,role) VALUES($1,$2,'owner')", [
      store.id,
      user.id,
    ]);
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
    const products: Record<string, string> = {};
    for (const [name, variant, unit, price, stock, threshold, aliases] of data) {
      const p = (
        await tx.query<RecordId>(
          'INSERT INTO products(store_id,name,normalized_name,variant,base_unit,price_quantity,price_paise,safety_stock) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [
            store.id,
            name,
            name.toLowerCase(),
            variant,
            unit,
            unit === 'gram' ? 1000 : 1,
            price,
            threshold,
          ],
        )
      )[0]!;
      products[name] = p.id;
      await tx.query(
        'INSERT INTO inventory_balances(store_id,product_id,quantity) VALUES($1,$2,$3)',
        [store.id, p.id, stock],
      );
      await tx.query(
        "INSERT INTO stock_movements(store_id,product_id,delta,kind,actor_id) VALUES($1,$2,$3,'opening',$4)",
        [store.id, p.id, stock, user.id],
      );
      for (const alias of aliases)
        await tx.query('INSERT INTO product_aliases(store_id,product_id,alias) VALUES($1,$2,$3)', [
          store.id,
          p.id,
          alias,
        ]);
    }
    const customers: Record<string, string> = {};
    for (const [name, productName, qty, total] of [
      ['Ramesh', 'Rice', 2000, 14000],
      ['Sita', 'Tea', 1, 12000],
    ] as const) {
      const customer = (
        await tx.query<RecordId>(
          'INSERT INTO customers(store_id,name) VALUES($1,$2) RETURNING id',
          [store.id, name],
        )
      )[0]!;
      customers[name] = customer.id;
      await tx.query('INSERT INTO customer_aliases(store_id,customer_id,alias) VALUES($1,$2,$3)', [
        store.id,
        customer.id,
        name.toLowerCase(),
      ]);
      const sale = (
        await tx.query<RecordId>(
          "INSERT INTO sales(store_id,customer_id,payment_method,total_paise,actor_id,created_at) VALUES($1,$2,'credit',$3,$4,now()-interval '1 day') RETURNING id",
          [store.id, customer.id, total, user.id],
        )
      )[0]!;
      const p = data.find((d) => d[0] === productName)!;
      const line = (
        await tx.query<RecordId>(
          'INSERT INTO sale_items(store_id,sale_id,product_id,name,variant,base_unit,quantity,price_quantity,price_paise,line_total_paise) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
          [
            store.id,
            sale.id,
            products[productName],
            p[0],
            p[1],
            p[2],
            qty,
            p[2] === 'gram' ? 1000 : 1,
            p[3],
            total,
          ],
        )
      )[0]!;
      await tx.query(
        'UPDATE inventory_balances SET quantity=quantity-$3 WHERE store_id=$1 AND product_id=$2',
        [store.id, products[productName], qty],
      );
      await tx.query(
        "INSERT INTO stock_movements(store_id,product_id,delta,kind,sale_item_id,actor_id,created_at) VALUES($1,$2,$3,'sale',$4,$5,now()-interval '1 day')",
        [store.id, products[productName], -qty, line.id, user.id],
      );
      await tx.query(
        "INSERT INTO khata_entries(store_id,customer_id,kind,amount_paise,sale_id,actor_id,created_at) VALUES($1,$2,'sale_debit',$3,$4,$5,now()-interval '1 day')",
        [store.id, customer.id, total, sale.id, user.id],
      );
    }
    return { userId: user.id, storeId: store.id, products, customers };
  });
}
