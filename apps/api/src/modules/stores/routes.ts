import type { Database } from '@munim/db';
import { type StoreRoute, empty } from '../../lib/router';
import { settingsInput, inviteInput } from '@munim/contracts';
import { settings } from '../catalog/repository';
import { one, fail, token, hash } from '../../lib/core';
export function registerStoresRoutes(route: StoreRoute, db: Database, origin: string) {
  route('GET', '/settings', empty, async (_, c) => settings(db, c.storeId));
  route(
    'PATCH',
    '/settings',
    settingsInput,
    async (v, c) =>
      one(
        db,
        'UPDATE stores SET name=$2,credit_confirmation_threshold_paise=$3,pav_grams=$4,upi_payee=$5,upi_name=$6,settings_version=settings_version+1 WHERE id=$1 AND settings_version=$7 RETURNING *',
        [
          c.storeId,
          v.name,
          v.creditConfirmationThresholdPaise,
          v.pavGrams,
          v.upiPayee,
          v.upiName,
          v.expectedVersion,
        ],
      ).catch((e) => {
        if (e.status === 404) fail(409, 'STALE_VERSION', 'Settings changed; reload before saving.');
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
      const invite = await one<{ id: string }>(
        db,
        "INSERT INTO account_invites(store_id,email,role,token_hash,expires_at) VALUES($1,$2,'staff',$3,now()+interval '2 days') RETURNING id",
        [c.storeId, v.email, hash(raw)],
      );
      return { id: invite.id, url: `${origin}/invite#${raw}` };
    },
    true,
  );
}
