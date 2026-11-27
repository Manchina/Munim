import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import argon2 from 'argon2';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Database } from '@munim/db';
import { testDatabase } from '../../../packages/db/src/testing';
import { seedDemo } from '../../../packages/db/src/seed';
import { createApp } from '../src/app';
import { one } from '../src/lib/core';
import type { Preview, Sale, Product } from '@munim/contracts';
let db: Database,
  app: FastifyInstance,
  fixture: Awaited<ReturnType<typeof seedDemo>>,
  cookie: string;
const origin = 'http://localhost:5173',
  password = 'Test-password-123!';
const key = () => crypto.randomUUID();
function request(method: InjectOptions['method'], path: string, payload?: unknown, idem?: string) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, cookie, ...(idem ? { 'idempotency-key': idem } : {}) },
    ...(payload === undefined
      ? {}
      : {
          payload: JSON.stringify(payload),
          headers: {
            origin,
            cookie,
            'content-type': 'application/json',
            ...(idem ? { 'idempotency-key': idem } : {}),
          },
        }),
  });
}
const path = (s: string) => `/stores/${fixture.storeId}${s}`;
const cart = (productId: string, quantity: number, customerId: string | null = null) => ({
  items: [{ productId, quantity }],
  paymentMethod: customerId ? 'credit' : 'cash',
  customerId,
});
async function quote(productId: string, qty: number, customerId: string | null = null) {
  const response = await request('POST', path('/sales/preview'), cart(productId, qty, customerId));
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Preview>();
}
beforeAll(async () => {
  db = await testDatabase();
  fixture = await seedDemo(db, 'owner@test.local', await argon2.hash(password));
  app = await createApp(db, { origin, quoteSecret: 'test-secret-with-at-least-32-characters' });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: 'owner@test.local', password },
  });
  expect(login.statusCode, login.body).toBe(200);
  cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
describe('store transactions and access', () => {
  it('requires authentication and the expected origin', async () => {
    const unauth = await app.inject({ method: 'GET', url: `/api/v1${path('/products')}` });
    expect(unauth.statusCode).toBe(401);
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1${path('/sales/preview')}`,
      headers: { cookie, origin: 'https://evil.example' },
      payload: cart(fixture.products.Bread!, 1),
    });
    expect(forbidden.statusCode).toBe(403);
  });
  it('seeds itemized balances and twelve products', async () => {
    const products = (await request('GET', path('/products'))).json<{ items: Product[] }>();
    expect(products.items).toHaveLength(12);
    const khata = (await request('GET', path('/khata'))).json<{
      items: { balancePaise: number }[];
    }>();
    expect(khata.items.map((i) => i.balancePaise).sort()).toEqual([12000, 14000]);
  });
  it('commits a sale once and reports a threshold crossing', async () => {
    const q = await quote(fixture.products.Bread!, 1),
      idem = key();
    const payload = { quote: q.quote, confirmed: true };
    const first = await request('POST', path('/sales'), payload, idem);
    expect(first.statusCode, first.body).toBe(200);
    const sale = first.json<Sale>();
    expect(sale.lowStock).toEqual(['Bread']);
    const retry = await request('POST', path('/sales'), payload, idem);
    expect(retry.json()).toEqual(sale);
    const p = await one<Product>(
      db,
      'SELECT quantity FROM inventory_balances WHERE store_id=$1 AND product_id=$2',
      [fixture.storeId, fixture.products.Bread],
    );
    expect(p.quantity).toBe(5);
    const conflict = await request(
      'POST',
      path('/sales'),
      { ...payload, quote: q.quote + 'x' },
      idem,
    );
    expect(conflict.statusCode).toBe(409);
  });
  it('does not emit another crossing while already low', async () => {
    const q = await quote(fixture.products.Bread!, 1);
    const result = await request(
      'POST',
      path('/sales'),
      { quote: q.quote, confirmed: true },
      key(),
    );
    expect(result.json<Sale>().lowStock).toEqual([]);
  });
  it('prevents overselling and rolls back the entire transaction', async () => {
    const q1 = await quote(fixture.products.Bread!, 3),
      q2 = await quote(fixture.products.Bread!, 3);
    const results = await Promise.all([
      request('POST', path('/sales'), { quote: q1.quote, confirmed: true }, key()),
      request('POST', path('/sales'), { quote: q2.quote, confirmed: true }, key()),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const p = await one<{ quantity: number }>(
      db,
      'SELECT quantity FROM inventory_balances WHERE store_id=$1 AND product_id=$2',
      [fixture.storeId, fixture.products.Bread],
    );
    expect(p.quantity).toBe(1);
  });
  it('rejects stale price quotes without recording any sale', async () => {
    const q = await quote(fixture.products.Sugar!, 1000);
    await db.query(
      'UPDATE products SET price_paise=price_paise+100,version=version+1 WHERE id=$1',
      [fixture.products.Sugar],
    );
    const result = await request(
      'POST',
      path('/sales'),
      { quote: q.quote, confirmed: true },
      key(),
    );
    expect(result.statusCode).toBe(409);
    expect(result.json().error.code).toBe('QUOTE_CHANGED');
  });
  it('posts credit, partial payment and full settlement without stock changes from payment', async () => {
    const q = await quote(fixture.products['Toor dal']!, 1000, fixture.customers.Ramesh!);
    const saleResponse = await request(
      'POST',
      path('/sales'),
      { quote: q.quote, confirmed: true },
      key(),
    );
    expect(saleResponse.statusCode, saleResponse.body).toBe(200);
    const customerId = fixture.customers.Ramesh!;
    const paymentKey = key();
    const body = { amountPaise: 10000, method: 'cash' };
    const payment = await request(
      'POST',
      path(`/customers/${customerId}/payments`),
      body,
      paymentKey,
    );
    expect(payment.json().balancePaise).toBe(16000);
    expect(
      (await request('POST', path(`/customers/${customerId}/payments`), body, paymentKey)).json(),
    ).toEqual(payment.json());
    const over = await request(
      'POST',
      path(`/customers/${customerId}/payments`),
      { amountPaise: 16001, method: 'cash' },
      key(),
    );
    expect(over.statusCode).toBe(422);
    const full = await request(
      'POST',
      path(`/customers/${customerId}/payments`),
      { amountPaise: 16000, method: 'upi' },
      key(),
    );
    expect(full.json().balancePaise).toBe(0);
    const p = await one<{ quantity: number }>(
      db,
      'SELECT quantity FROM inventory_balances WHERE store_id=$1 AND product_id=$2',
      [fixture.storeId, fixture.products['Toor dal']],
    );
    expect(p.quantity).toBe(5000);
  });
  it('counts independent demand once each and preserves variants', async () => {
    const body = { name: 'Amul butter', variant: '500 g' };
    const idem = key();
    const first = await request('POST', path('/restock-requests'), body, idem);
    const retry = await request('POST', path('/restock-requests'), body, idem);
    expect(first.json()).toEqual(retry.json());
    const second = await request(
      'POST',
      path('/restock-requests'),
      { name: 'AMUL BUTTER', variant: '500g' },
      key(),
    );
    expect(second.json().requestCount).toBe(2);
    const other = await request(
      'POST',
      path('/restock-requests'),
      { name: 'Amul butter', variant: '100g' },
      key(),
    );
    expect(other.json().id).not.toBe(first.json().id);
  });
  it('receives catalog stock and closes a request atomically', async () => {
    const r = await request(
      'POST',
      path('/restock-requests'),
      { productId: fixture.products.Bread, name: 'Bread' },
      key(),
    );
    const idem = key();
    const procured = await request(
      'POST',
      path(`/restock-requests/${r.json().id}/procure`),
      { quantityReceived: 10 },
      idem,
    );
    expect(procured.statusCode, procured.body).toBe(200);
    await request(
      'POST',
      path(`/restock-requests/${r.json().id}/procure`),
      { quantityReceived: 10 },
      idem,
    );
    expect(
      (
        await one<{ quantity: number }>(
          db,
          'SELECT quantity FROM inventory_balances WHERE product_id=$1',
          [fixture.products.Bread],
        )
      ).quantity,
    ).toBe(11);
  });
  it('scopes receipt sharing to a minimal public sale and allows revocation', async () => {
    const q = await quote(fixture.products.Milk!, 1);
    const sale = await request('POST', path('/sales'), { quote: q.quote, confirmed: true }, key());
    const link = await request('POST', path(`/sales/${sale.json().id}/receipt-links`));
    const value = link.json<{ id: string; url: string }>();
    const raw = value.url.split('/').pop()!;
    const receipt = await app.inject({ method: 'GET', url: `/api/v1/receipts/${raw}` });
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(receipt.headers['cache-control']).toBe('no-store');
    expect(receipt.body).not.toMatch(/customerId|storeId|productId|actorId|balancePaise/);
    await request('DELETE', path(`/sales/${sale.json().id}/receipt-links/${value.id}`));
    expect((await app.inject({ method: 'GET', url: `/api/v1/receipts/${raw}` })).statusCode).toBe(
      404,
    );
  });
  it('blocks cross-store reads, writes and foreign-key references', async () => {
    const other = await seedDemo(db, 'other@test.local', 'unused-test-hash');
    expect((await request('GET', `/stores/${other.storeId}/products`)).statusCode).toBe(404);
    const foreign = await request('POST', path('/sales/preview'), cart(other.products.Rice!, 1000));
    expect(foreign.statusCode).toBe(404);
    await expect(
      db.query('INSERT INTO inventory_balances(store_id,product_id,quantity) VALUES($1,$2,1)', [
        fixture.storeId,
        other.products.Rice,
      ]),
    ).rejects.toThrow();
  });
  it('restricts owners-only routes for staff and consumes invitations once', async () => {
    const created = await request('POST', path('/invites'), { email: 'staff@test.local' });
    const raw = created.json().url.split('#')[1];
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      headers: { origin },
      payload: { token: raw, password },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const staffCookie = accepted.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1${path('/products')}`,
      headers: { origin, cookie: staffCookie },
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/accept-invite',
          headers: { origin },
          payload: { token: raw, password },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('rejects missing idempotency keys and unconfirmed checkouts', async () => {
    const q = await quote(fixture.products.Milk!, 1);
    expect(
      (await request('POST', path('/sales'), { quote: q.quote, confirmed: true })).statusCode,
    ).toBe(400);
    expect(
      (await request('POST', path('/sales'), { quote: q.quote, confirmed: false }, key()))
        .statusCode,
    ).toBe(400);
  });
  it('protects audit history against direct rewrites', async () => {
    for (const table of ['sales', 'sale_items', 'khata_entries', 'stock_movements'])
      await expect(
        db.query(`DELETE FROM ${table} WHERE store_id=$1`, [fixture.storeId]),
      ).rejects.toThrow('append-only');
  });
  it('rolls back sale, inventory and idempotency if credit posting fails', async () => {
    const q = await quote(fixture.products.Rice!, 1000, fixture.customers.Ramesh!);
    const before = await one<{ quantity: number }>(
      db,
      'SELECT quantity FROM inventory_balances WHERE product_id=$1',
      [fixture.products.Rice],
    );
    const count = await one<{ count: number }>(
      db,
      'SELECT count(*)::int AS count FROM sales WHERE store_id=$1',
      [fixture.storeId],
    );
    const idem = key();
    await db.query(
      "CREATE FUNCTION reject_test_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test credit failure' USING ERRCODE='23514'; END; $$",
    );
    await db.query(
      'CREATE TRIGGER reject_test_credit BEFORE INSERT ON khata_entries FOR EACH ROW EXECUTE FUNCTION reject_test_credit()',
    );
    try {
      const response = await request(
        'POST',
        path('/sales'),
        { quote: q.quote, confirmed: true },
        idem,
      );
      expect(response.statusCode, response.body).toBe(422);
      expect(
        await one(db, 'SELECT quantity FROM inventory_balances WHERE product_id=$1', [
          fixture.products.Rice,
        ]),
      ).toEqual(before);
      expect(
        await one(db, 'SELECT count(*)::int AS count FROM sales WHERE store_id=$1', [
          fixture.storeId,
        ]),
      ).toEqual(count);
      expect(
        await one(
          db,
          'SELECT count(*)::int AS count FROM idempotency_records WHERE store_id=$1 AND key=$2',
          [fixture.storeId, idem],
        ),
      ).toEqual({ count: 0 });
    } finally {
      await db.query('DROP TRIGGER reject_test_credit ON khata_entries');
      await db.query('DROP FUNCTION reject_test_credit()');
    }
  });
  it('serializes competing partial payments without over-settling', async () => {
    const endpoint = path(`/customers/${fixture.customers.Sita}/payments`);
    const responses = await Promise.all([
      request('POST', endpoint, { amountPaise: 10000, method: 'cash' }, key()),
      request('POST', endpoint, { amountPaise: 10000, method: 'cash' }, key()),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 422]);
    expect(
      (await request('GET', path(`/customers/${fixture.customers.Sita}/khata`))).json()
        .balancePaise,
    ).toBe(2000);
  });
  it('rejects a monetary overflow as a domain error', async () => {
    const created = await request('POST', path('/products'), {
      name: 'Amount limit fixture',
      baseUnit: 'each',
      priceQuantity: 1,
      pricePaise: Number.MAX_SAFE_INTEGER,
      safetyStock: 0,
      openingStock: 2,
    });
    expect(created.statusCode, created.body).toBe(200);
    const response = await request('POST', path('/sales/preview'), cart(created.json().id, 2));
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.code).toBe('AMOUNT_LIMIT');
  });
});
