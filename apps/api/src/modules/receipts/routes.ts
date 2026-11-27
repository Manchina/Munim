import type { FastifyInstance } from 'fastify';
import { schema, type Database } from '@munim/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { type StoreRoute, param, empty } from '../../lib/router';
import { z } from 'zod';
import { saleDetail, publicReceipt } from '../sales/service';
import { settings } from '../catalog/repository';
import { one, hash, token } from '../../lib/core';
const { receiptLinks } = schema;
export function registerReceiptsRoutes(
  route: StoreRoute,
  db: Database,
  origin: string,
  app: FastifyInstance,
) {
  route('POST', '/sales/:saleId/receipt-links', empty, async (_, c, req) => {
    const saleId = param(req, 'saleId');
    await saleDetail(db, c.storeId, saleId);
    const raw = token();
    const link = await one(
      db
        .insert(receiptLinks)
        .values({
          storeId: c.storeId,
          saleId,
          tokenHash: hash(raw),
          expiresAt: new Date(Date.now() + 7 * 86400000),
          creatorId: c.userId,
        })
        .returning({ id: receiptLinks.id, expiresAt: receiptLinks.expiresAt }),
    );
    return { ...link, url: `${origin}/receipt/${raw}` };
  });
  route('DELETE', '/sales/:saleId/receipt-links/:linkId', empty, async (_, c, req) =>
    one(
      db
        .update(receiptLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(receiptLinks.storeId, c.storeId),
            eq(receiptLinks.saleId, param(req, 'saleId')),
            eq(receiptLinks.id, param(req, 'linkId')),
          ),
        )
        .returning({ id: receiptLinks.id }),
    ),
  );
  app.get(
    '/api/v1/receipts/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const raw = z
        .string()
        .length(43)
        .parse((req.params as { token: string }).token);
      const link = await one(
        db
          .select({ storeId: receiptLinks.storeId, saleId: receiptLinks.saleId })
          .from(receiptLinks)
          .where(
            and(
              eq(receiptLinks.tokenHash, hash(raw)),
              isNull(receiptLinks.revokedAt),
              gt(receiptLinks.expiresAt, new Date()),
            ),
          ),
      );
      reply
        .header('Cache-Control', 'no-store')
        .header('Referrer-Policy', 'no-referrer')
        .header('X-Robots-Tag', 'noindex, nofollow');
      return publicReceipt(
        await saleDetail(db, link.storeId, link.saleId),
        await settings(db, link.storeId),
      );
    },
  );
}
