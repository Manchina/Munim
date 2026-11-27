import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Database } from '@munim/db';
import { AppError, fail } from './lib/core';
import { registerAuth } from './modules/auth/routes';
import { registerStoreRoutes } from './modules/routes';
export type Config = {
  origin: string;
  quoteSecret: string;
  production?: boolean;
  logger?: boolean;
};
export async function createApp(db: Database, config: Config) {
  if (config.quoteSecret.length < 32)
    throw new Error('QUOTE_SECRET must have at least 32 characters.');
  const app = Fastify({
    logger: config.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 65536,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.addHook('onRequest', async (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin)
      fail(403, 'ORIGIN_REJECTED', 'Request origin was not accepted.');
  });
  app.addHook('onSend', async (_, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: 'Check the submitted fields.',
          fieldErrors: error.flatten().fieldErrors,
        },
        requestId: req.id,
      });
    if (error instanceof AppError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message }, requestId: req.id });
    const e = error as { code?: string; statusCode?: number };
    if (e.code === '23505')
      return reply.code(409).send({
        error: { code: 'ALREADY_EXISTS', message: 'This record already exists.' },
        requestId: req.id,
      });
    if (['23514', '23503', '22003'].includes(e.code ?? ''))
      return reply.code(422).send({
        error: {
          code: 'INVALID_REFERENCE_OR_VALUE',
          message: 'Check the referenced records and values.',
        },
        requestId: req.id,
      });
    const status = e.statusCode && e.statusCode < 500 ? e.statusCode : 500;
    // Do not log request bodies, URLs, tokens, SQL arguments, or driver error details.
    if (status === 500)
      app.log.error({ requestId: req.id, code: e.code ?? 'INTERNAL' }, 'Request failed');
    return reply.code(status).send({
      error: {
        code: status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED',
        message:
          status === 500 ? 'Unable to complete the request.' : 'Request could not be accepted.',
      },
      requestId: req.id,
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Endpoint was not found.' },
      requestId: req.id,
    }),
  );
  await registerAuth(app, db, config.production ?? false);
  app.get('/health/live', async () => ({ ok: true }));
  app.get('/health/ready', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });
  registerStoreRoutes(app, db, config.quoteSecret, config.origin);
  return app;
}
