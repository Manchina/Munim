import { schema, type Database } from '@munim/db';
import { and, eq, sql } from 'drizzle-orm';
import { type StoreRoute, empty } from '../../lib/router';
import { settingsInput, inviteInput } from '@munim/contracts';
import { settings } from '../catalog/repository';
import { one, fail, token, hash } from '../../lib/core';
const { stores, invites } = schema;
export function registerStoresRoutes(route: StoreRoute, db: Database, origin: string) {
  route('GET', '/settings', empty, async (_, c) => settings(db, c.storeId));
  route(
    'PATCH',
    '/settings',
    settingsInput,
    async (v, c) =>
      one(
        db
          .update(stores)
          .set({
            name: v.name,
            creditConfirmationThresholdPaise: v.creditConfirmationThresholdPaise,
            pavGrams: v.pavGrams,
            upiPayee: v.upiPayee,
            upiName: v.upiName,
            settingsVersion: sql`${stores.settingsVersion} + 1`,
          })
          .where(and(eq(stores.id, c.storeId), eq(stores.settingsVersion, v.expectedVersion)))
          .returning(),
      ).catch((e: unknown) => {
        if (e instanceof Error && 'status' in e && e.status === 404)
          fail(409, 'STALE_VERSION', 'Settings changed; reload before saving.');
        throw e;
      }),
    true,
  );
  route(
    'POST',
    '/invites',
    inviteInput,
    async (v, c) => {
      const raw = token();
      const invite = await one(
        db
          .insert(invites)
          .values({
            storeId: c.storeId,
            email: v.email,
            role: 'staff',
            tokenHash: hash(raw),
            expiresAt: new Date(Date.now() + 2 * 86400000),
          })
          .returning({ id: invites.id }),
      );
      return { id: invite.id, url: `${origin}/invite#${raw}` };
    },
    true,
  );
}
