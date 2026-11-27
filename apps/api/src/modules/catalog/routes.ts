import { schema, type Database } from '@munim/db';
import { and, eq, exists, gt, ilike, isNull, like, or } from 'drizzle-orm';
import { type StoreRoute, param, empty } from '../../lib/router';
import { productInput, productUpdate, supplierInput, pageInput, normalize } from '@munim/contracts';
import {
  product,
  productSelect,
  productsWithAliases,
  requireSupplier,
  aliases,
  moveStock,
  page,
} from './repository';
import { one, fail } from '../../lib/core';
const { products, inventoryBalances, productAliases, suppliers } = schema;
export function registerCatalogRoutes(route: StoreRoute, db: Database) {
  route('GET', '/products', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    const pattern = `%${normalize(p.q)}%`;
    const aliasMatch = db
      .select({ id: productAliases.id })
      .from(productAliases)
      .where(
        and(
          eq(productAliases.storeId, products.storeId),
          eq(productAliases.productId, products.id),
          like(productAliases.alias, pattern),
        ),
      );
    return page(
      await productsWithAliases(
        db,
        productSelect(db)
          .where(
            and(
              eq(products.storeId, c.storeId),
              isNull(products.archivedAt),
              p.cursor ? gt(products.id, p.cursor) : undefined,
              or(like(products.normalizedName, pattern), exists(aliasMatch)),
            ),
          )
          .orderBy(products.id)
          .limit(p.limit + 1),
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
        const p = await one(
          tx
            .insert(products)
            .values({
              storeId: c.storeId,
              name: v.name,
              normalizedName: normalize(v.name),
              variant: v.variant,
              sku: v.sku,
              baseUnit: v.baseUnit,
              priceQuantity: v.priceQuantity,
              pricePaise: v.pricePaise,
              safetyStock: v.safetyStock,
              supplierId: v.supplierId,
            })
            .returning({ id: products.id }),
        );
        await tx
          .insert(inventoryBalances)
          .values({ storeId: c.storeId, productId: p.id, quantity: 0 });
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
        await tx
          .update(products)
          .set({
            name: v.name,
            normalizedName: normalize(v.name),
            variant: v.variant,
            sku: v.sku,
            priceQuantity: v.priceQuantity,
            pricePaise: v.pricePaise,
            safetyStock: v.safetyStock,
            supplierId: v.supplierId,
            version: old.version + 1,
            archivedAt: v.archived ? new Date() : null,
          })
          .where(and(eq(products.storeId, c.storeId), eq(products.id, productId)));
        await aliases(tx, 'product', c.storeId, productId, v.aliases);
        return { id: productId, version: old.version + 1 };
      }),
    true,
  );
  route('GET', '/suppliers', empty, async (_, c, req) => {
    const p = pageInput.parse(req.query);
    return page(
      await db
        .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.storeId, c.storeId),
            isNull(suppliers.archivedAt),
            p.cursor ? gt(suppliers.id, p.cursor) : undefined,
            ilike(suppliers.name, `%${normalize(p.q)}%`),
          ),
        )
        .orderBy(suppliers.id)
        .limit(p.limit + 1),
      p.limit,
    );
  });
  const supplierFields = { id: suppliers.id, name: suppliers.name, phone: suppliers.phone };
  route(
    'POST',
    '/suppliers',
    supplierInput,
    async (v, c) =>
      one(
        db
          .insert(suppliers)
          .values({ storeId: c.storeId, name: v.name, phone: v.phone })
          .returning(supplierFields),
      ),
    true,
  );
  route(
    'PATCH',
    '/suppliers/:supplierId',
    supplierInput,
    async (v, c, req) =>
      one(
        db
          .update(suppliers)
          .set({ name: v.name, phone: v.phone, archivedAt: v.archived ? new Date() : null })
          .where(and(eq(suppliers.storeId, c.storeId), eq(suppliers.id, param(req, 'supplierId'))))
          .returning(supplierFields),
      ),
    true,
  );
}
