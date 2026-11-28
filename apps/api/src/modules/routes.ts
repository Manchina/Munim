import type { FastifyInstance } from 'fastify';
import type { Database } from '@munim/db';
import { createStoreRouter } from '../lib/router';
import { registerStoresRoutes } from './stores/routes';
import { registerCatalogRoutes } from './catalog/routes';
import { registerCustomersRoutes } from './customers/routes';
import { registerInventoryRoutes } from './inventory/routes';
import { registerSalesRoutes } from './sales/routes';
import { registerKhataRoutes } from './khata/routes';
import { registerRestockRoutes } from './restock/routes';
import { registerReceiptsRoutes } from './receipts/routes';
import { registerCommandRoutes, type OpenAIConfig } from './commands/routes';
export function registerStoreRoutes(
  app: FastifyInstance,
  db: Database,
  secret: string,
  origin: string,
  openAI?: OpenAIConfig,
) {
  const route = createStoreRouter(app, db);
  registerStoresRoutes(route, db, origin);
  registerCatalogRoutes(route, db);
  registerCustomersRoutes(route, db);
  registerInventoryRoutes(route, db);
  registerSalesRoutes(route, db, secret);
  registerKhataRoutes(route, db);
  registerRestockRoutes(route, db);
  registerReceiptsRoutes(route, db, origin, app);
  registerCommandRoutes(route, app, openAI);
}
