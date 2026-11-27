import type { Database } from '@munim/db';
import { type StoreRoute, param, empty } from '../../lib/router';
import {
  productInput,
  productUpdate,
  supplierInput,
  pageInput,
  normalize,
  type Product,
} from '@munim/contracts';
import { product, productSelect, requireSupplier, aliases, moveStock, page } from './repository';
import { one, rows, fail } from '../../lib/core';
export function registerCatalogRoutes(route: StoreRoute, db: Database) {
  route('GET', '/products', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<Product>(
        db,
        `${productSelect} WHERE p.store_id=$1 AND p.archived_at IS NULL AND ($2::uuid IS NULL OR p.id>$2) AND (p.normalized_name LIKE '%'||$3||'%' OR EXISTS(SELECT 1 FROM product_aliases a WHERE a.store_id=p.store_id AND a.product_id=p.id AND a.alias LIKE '%'||$3||'%')) ORDER BY p.id LIMIT $4`,
        [c.storeId, p.cursor ?? null, normalize(p.q), p.limit + 1],
      ),
      p.limit,
    );
  });
  route('GET', '/products/:productId', empty, async (_, c, req) =>
    product(db, c.storeId, param(req, 'productId')),
  );
  route(
    'POST',
    '/products',
    productInput,
    async (v, c) =>
      db.transaction(async (tx) => {
        await requireSupplier(tx, c.storeId, v.supplierId);
        const p = await one<{ id: string }>(
          tx,
          'INSERT INTO products(store_id,name,normalized_name,variant,sku,base_unit,price_quantity,price_paise,safety_stock,supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
          [
            c.storeId,
            v.name,
            normalize(v.name),
            v.variant,
            v.sku,
            v.baseUnit,
            v.priceQuantity,
            v.pricePaise,
            v.safetyStock,
            v.supplierId,
          ],
        );
        await tx.query(
          'INSERT INTO inventory_balances(store_id,product_id,quantity) VALUES($1,$2,0)',
          [c.storeId, p.id],
        );
        await aliases(tx, 'product', c.storeId, p.id, v.aliases);
        await moveStock(tx, c.storeId, c.userId, p.id, v.openingStock, 'opening');
        return product(tx, c.storeId, p.id);
      }),
    true,
  );
  route(
    'PATCH',
    '/products/:productId',
    productUpdate,
    async (v, c, req) =>
      db.transaction(async (tx) => {
        const productId = param(req, 'productId');
        const old = await product(tx, c.storeId, productId, true);
        if (old.version !== v.expectedVersion)
          fail(409, 'STALE_VERSION', 'Product changed; reload before saving.');
        if (old.baseUnit !== v.baseUnit)
          fail(422, 'UNIT_IMMUTABLE', 'Create a new product to change its base unit.');
        await requireSupplier(tx, c.storeId, v.supplierId);
        await tx.query(
          'UPDATE products SET name=$3,normalized_name=$4,variant=$5,sku=$6,price_quantity=$7,price_paise=$8,safety_stock=$9,supplier_id=$10,version=version+1,archived_at=$11 WHERE store_id=$1 AND id=$2',
          [
            c.storeId,
            productId,
            v.name,
            normalize(v.name),
            v.variant,
            v.sku,
            v.priceQuantity,
            v.pricePaise,
            v.safetyStock,
            v.supplierId,
            v.archived ? new Date() : null,
          ],
        );
        await aliases(tx, 'product', c.storeId, productId, v.aliases);
        return { id: productId, version: old.version + 1 };
      }),
    true,
  );
  route('GET', '/suppliers', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await rows<{ id: string; name: string; phone: string | null }>(
        db,
        "SELECT id,name,phone FROM suppliers WHERE store_id=$1 AND archived_at IS NULL AND ($2::uuid IS NULL OR id>$2) AND lower(name) LIKE '%'||$3||'%' ORDER BY id LIMIT $4",
        [c.storeId, p.cursor ?? null, normalize(p.q), p.limit + 1],
      ),
      p.limit,
    );
  });
  route(
    'POST',
    '/suppliers',
    supplierInput,
    async (v, c) =>
      one(
        db,
        'INSERT INTO suppliers(store_id,name,phone) VALUES($1,$2,$3) RETURNING id,name,phone',
        [c.storeId, v.name, v.phone],
      ),
    true,
  );
  route(
    'PATCH',
    '/suppliers/:supplierId',
    supplierInput,
    async (v, c, req) =>
      one(
        db,
        'UPDATE suppliers SET name=$3,phone=$4,archived_at=$5 WHERE store_id=$1 AND id=$2 RETURNING id,name,phone',
        [c.storeId, param(req, 'supplierId'), v.name, v.phone, v.archived ? new Date() : null],
      ),
    true,
  );
}
