import type { FastifyInstance } from 'fastify';
import type { Database } from '@munim/db';
import { type StoreRoute, param, empty } from '../../lib/router';
import { z } from 'zod';
import { saleDetail, publicReceipt } from '../sales/service';
import { settings } from '../catalog/repository';
import { one, hash, token } from '../../lib/core';
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
    const link = await one<{ id: string; expiresAt: string }>(
      db,
      "INSERT INTO receipt_links(store_id,sale_id,token_hash,expires_at,creator_id) VALUES($1,$2,$3,now()+interval '7 days',$4) RETURNING id,expires_at",
      [c.storeId, saleId, hash(raw), c.userId],
    );
    return { ...link, url: `${origin}/receipt/${raw}` };
  });
  route('DELETE', '/sales/:saleId/receipt-links/:linkId', empty, async (_, c, req) =>
    one(
      db,
      'UPDATE receipt_links SET revoked_at=now() WHERE store_id=$1 AND sale_id=$2 AND id=$3 RETURNING id',
      [c.storeId, param(req, 'saleId'), param(req, 'linkId')],
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
      const link = await one<{ storeId: string; saleId: string }>(
        db,
        'SELECT store_id,sale_id FROM receipt_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',
        [hash(raw)],
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
