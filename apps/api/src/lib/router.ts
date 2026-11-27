import type { FastifyInstance, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import { id } from '@munim/contracts';
import type { Database } from '@munim/db';
import { authorize } from '../modules/auth/routes';
export type Context = { storeId: string; userId: string; role: 'owner' | 'staff' };
export const param = (req: FastifyRequest, name: string) =>
  id.parse((req.params as Record<string, string>)[name]);
export const key = (req: FastifyRequest) =>
  typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
export type StoreRoute = <S extends z.ZodTypeAny>(
  method: HTTPMethods,
  path: string,
  schema: S,
  fn: (input: z.output<S>, ctx: Context, req: FastifyRequest) => Promise<unknown>,
  owner?: boolean,
) => void;
export function createStoreRouter(app: FastifyInstance, db: Database): StoreRoute {
  return (method, routePath, schema, fn, owner = false) => {
    app.route({
      method,
      url: '/api/v1/stores/:storeId' + routePath,
      handler: async (req) => {
        param(req, 'storeId');
        const ctx = await authorize(req, db, owner);
        return fn(schema.parse(req.body), ctx, req);
      },
    });
  };
}
export const empty = z.unknown();
