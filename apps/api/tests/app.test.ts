import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { hashPassword } from '@munim/db';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Database } from '@munim/db';
import { schema } from '@munim/db';
import { and, count, DrizzleQueryError, eq, ne, sql } from 'drizzle-orm';
import { testDatabase } from '../../../packages/db/src/testing';
import { seedDemo } from '../../../packages/db/src/seed';
import { createApp } from '../src/app';
import { one } from '../src/lib/core';
import {
  commandAudioLimit,
  type Preview,
  type Sale,
  type Product,
  type Customer,
  type Page,
  type LedgerEntry,
} from '@munim/contracts';
let db: Database,
  app: FastifyInstance,
  fixture: Awaited<ReturnType<typeof seedDemo>>,
  cookie: string;
const origin = 'http://localhost:5173',
  password = 'Test-password-123!';
const key = () => crypto.randomUUID();
const {
  inventoryBalances,
  products,
  sales,
  saleItems,
  khataEntries,
  stockMovements,
  idempotencyRecords,
} = schema;
const stock = (productId: string) =>
  one(
    db
      .select({ quantity: inventoryBalances.quantity })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.storeId, fixture.storeId),
          eq(inventoryBalances.productId, productId),
        ),
      ),
  );
const saleCount = () =>
  one(db.select({ count: count() }).from(sales).where(eq(sales.storeId, fixture.storeId)));
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
  fixture = await seedDemo(db, 'owner@test.local', await hashPassword(password));
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
describe('OpenAI command interpretation', () => {
  it('limits and transcribes explicitly submitted audio for an authorized store', async () => {
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ text: '  aadha kilo rice  ' }));
    const agent = await createApp(db, {
      origin,
      quoteSecret: 'test-secret-with-at-least-32-characters',
      openAI: { apiKey: 'mock-key', fetch: provider },
    });
    const clip = Buffer.from([1, 2, 3]);
    const upload = (body = clip, session = cookie) =>
      agent.inject({
        method: 'POST',
        url: `/api/v1${path('/commands/transcribe')}`,
        headers: { origin, cookie: session, 'content-type': 'audio/webm;codecs=opus' },
        payload: body,
      });
    try {
      expect((await upload(clip, '')).statusCode).toBe(401);
      expect((await upload(Buffer.alloc(commandAudioLimit + 1))).statusCode).toBe(413);
      expect(provider).not.toHaveBeenCalled();
      const response = await upload();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ transcript: 'aadha kilo rice' });
      const [url, init] = provider.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-transcribe');
      expect(await (form.get('file') as Blob).arrayBuffer()).toEqual(new Uint8Array(clip).buffer);
    } finally {
      await agent.close();
    }
  });
  const payload = { transcript: 'aadha kilo rice aur do Lifebuoy sabun' };
  const route = '/commands/interpret';
  const output = (text: string) =>
    Response.json({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    });

  it('lets the counter fall back when no key is configured', async () => {
    const response = await request('POST', path(route), payload);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('AGENT_UNAVAILABLE');
  });

  it('checks store access, normalizes commands and handles invalid outputs and outages', async () => {
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(output('{"command":"0.5 kg rice, 2 Lifebuoy sabun"}'))
      .mockResolvedValueOnce(output('{"command":null}'))
      .mockResolvedValueOnce(output('{"command":123}'))
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockImplementation(async () => output('{"command":"checkout"}'));
    const agent = await createApp(db, {
      origin,
      quoteSecret: 'test-secret-with-at-least-32-characters',
      openAI: { apiKey: 'mock-key', fetch: provider },
    });
    const send = (headers = { origin, cookie }, body: unknown = payload, endpoint = path(route)) =>
      agent.inject({ method: 'POST', url: `/api/v1${endpoint}`, headers, payload: body as object });
    try {
      expect((await send({ origin, cookie: '' })).statusCode).toBe(401);
      expect((await send({ origin: 'https://example.org', cookie })).statusCode).toBe(403);
      expect(
        (await send({ origin, cookie }, payload, `/stores/${crypto.randomUUID()}${route}`))
          .statusCode,
      ).toBe(404);
      expect((await send({ origin, cookie }, { transcript: ' ' })).statusCode).toBe(400);
      expect(provider).not.toHaveBeenCalled();

      const normalized = await send();
      expect(normalized.statusCode).toBe(200);
      expect(normalized.json()).toEqual({
        type: 'normalized',
        command: '0.5 kg rice, 2 Lifebuoy sabun',
      });
      const [url, init] = provider.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/responses');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        store: false,
        model: 'gpt-5-mini',
        input: payload.transcript,
        text: { format: { type: 'json_schema', strict: true } },
      });
      expect((await send()).json().type).toBe('clarify');
      expect((await send()).statusCode).toBe(503);
      expect((await send()).statusCode).toBe(503);
      for (let i = 4; i < 30; i++) expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(429);
      expect(provider).toHaveBeenCalledTimes(30);
    } finally {
      await agent.close();
    }
  });
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
  it('accepts the alternate local development origin but rejects other origins', async () => {
    const alternate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: { email: 'owner@test.local', password },
    });
    expect(alternate.statusCode, alternate.body).toBe(200);
    for (const origin of ['http://localhost:5174', 'http://localhost.evil.example:5173', 'null']) {
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin },
        payload: { email: 'owner@test.local', password },
      });
      expect(denied.statusCode).toBe(403);
    }
    const production = await createApp(db, {
      origin,
      quoteSecret: 'test-secret-with-at-least-32-characters',
      production: true,
    });
    try {
      const denied = await production.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:5173' },
        payload: { email: 'owner@test.local', password },
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await production.close();
    }
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
    const p = await stock(fixture.products.Bread!);
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
    const p = await stock(fixture.products.Bread!);
    expect(p.quantity).toBe(1);
  });
  it('rejects stale price quotes without recording any sale', async () => {
    const q = await quote(fixture.products.Sugar!, 1000);
    await db
      .update(products)
      .set({ pricePaise: sql`${products.pricePaise} + 100`, version: sql`${products.version} + 1` })
      .where(eq(products.id, fixture.products.Sugar!));
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
    const p = await stock(fixture.products['Toor dal']!);
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
    expect((await stock(fixture.products.Bread!)).quantity).toBe(11);
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
      db
        .insert(inventoryBalances)
        .values({ storeId: fixture.storeId, productId: other.products.Rice!, quantity: 1 }),
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
    for (const table of [sales, saleItems, khataEntries, stockMovements]) {
      const error: unknown = await db
        .delete(table)
        .where(eq(table.storeId, fixture.storeId))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DrizzleQueryError);
      expect((error as DrizzleQueryError).cause?.message).toContain('append-only');
    }
  });
  it('rolls back sale, inventory and idempotency if credit posting fails', async () => {
    const q = await quote(fixture.products.Rice!, 1000, fixture.customers.Ramesh!);
    const before = await stock(fixture.products.Rice!);
    const beforeCount = await saleCount();
    const idem = key();
    await db.execute(
      sql`CREATE FUNCTION reject_test_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test credit failure' USING ERRCODE='23514'; END; $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER reject_test_credit BEFORE INSERT ON khata_entries FOR EACH ROW EXECUTE FUNCTION reject_test_credit()`,
    );
    try {
      const response = await request(
        'POST',
        path('/sales'),
        { quote: q.quote, confirmed: true },
        idem,
      );
      expect(response.statusCode, response.body).toBe(422);
      expect(await stock(fixture.products.Rice!)).toEqual(before);
      expect(await saleCount()).toEqual(beforeCount);
      expect(
        await one(
          db
            .select({ count: count() })
            .from(idempotencyRecords)
            .where(
              and(
                eq(idempotencyRecords.storeId, fixture.storeId),
                eq(idempotencyRecords.key, idem),
              ),
            ),
        ),
      ).toEqual({ count: 0 });
    } finally {
      await db.execute(sql`DROP TRIGGER reject_test_credit ON khata_entries`);
      await db.execute(sql`DROP FUNCTION reject_test_credit()`);
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

  it('searches normalized aliases and paginates store-scoped catalog records', async () => {
    const aliasSearch = await request('GET', path('/products?q=ARHAR'));
    expect(aliasSearch.statusCode, aliasSearch.body).toBe(200);
    expect(aliasSearch.json<Page<Product>>().items.map((p) => p.id)).toEqual([
      fixture.products['Toor dal'],
    ]);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(
        'GET',
        path(`/products?limit=3${cursor ? `&cursor=${cursor}` : ''}`),
      );
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json<Page<Product>>();
      ids.push(...result.items.map((p) => p.id));
      cursor = result.nextCursor;
      expect(ids.length).toBeLessThanOrEqual(20);
    } while (cursor);
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    const inventory = (await request('GET', path('/inventory'))).json<
      Page<Product & { lowStock: boolean }>
    >();
    expect(inventory.items.every((p) => p.lowStock === p.quantity <= p.safetyStock)).toBe(true);
  });

  it('updates aliases and preserves database constraint errors through Drizzle', async () => {
    const supplier = await request('POST', path('/suppliers'), { name: 'Wholesale Fixture' });
    expect(supplier.statusCode, supplier.body).toBe(200);
    const supplierId = supplier.json<{ id: string }>().id;
    const body = {
      name: 'Alias fixture',
      sku: 'drizzle-fixture',
      baseUnit: 'each',
      priceQuantity: 1,
      pricePaise: 100,
      safetyStock: 0,
      openingStock: 2,
      supplierId,
      aliases: [' Zed ', 'alpha', 'ALPHA'],
    };
    const created = await request('POST', path('/products'), body);
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<Product>().aliases).toEqual(['alpha', 'zed']);
    const duplicate = await request('POST', path('/products'), body);
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json().error.code).toBe('ALREADY_EXISTS');
    expect(duplicate.body).not.toMatch(/Failed query|params:|insert into/i);
    const { openingStock: _openingStock, ...update } = body;
    const changed = await request('PATCH', path(`/products/${created.json<Product>().id}`), {
      ...update,
      expectedVersion: 1,
      aliases: [],
      pricePaise: 125,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const detail = (
      await request('GET', path(`/products/${created.json<Product>().id}`))
    ).json<Product>();
    expect(detail).toMatchObject({ aliases: [], pricePaise: 125, version: 2 });
    const customer = await request('POST', path('/customers'), {
      name: 'Alias Customer',
      aliases: ['Bhai', 'BHAI'],
    });
    expect(customer.statusCode, customer.body).toBe(200);
    expect(customer.json<Customer>().aliases).toEqual(['bhai']);
    const updated = await request('PATCH', path(`/customers/${customer.json<Customer>().id}`), {
      name: 'Renamed Customer',
      aliases: [],
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const found = (await request('GET', path('/customers?q=RENAMED'))).json<Page<Customer>>();
    expect(found.items).toHaveLength(1);
    expect(found.items[0]?.aliases).toEqual([]);
    const suppliers = (await request('GET', path('/suppliers?q=WHOLESALE'))).json<
      Page<{ id: string }>
    >();
    expect(suppliers.items.map((s) => s.id)).toEqual([supplierId]);
  });

  it('keeps exact timestamp ordering and cursor scope in sales and ledger history', async () => {
    const customer = await one(
      db
        .insert(schema.customers)
        .values({ storeId: fixture.storeId, name: 'Pagination Fixture' })
        .returning({ id: schema.customers.id }),
    );
    const saleIds = [1, 2, 3].map((n) => `10000000-0000-4000-8000-00000000000${n}`);
    const entryIds = [1, 2, 3].map((n) => `20000000-0000-4000-8000-00000000000${n}`);
    for (let i = 0; i < 3; i++) {
      const createdAt =
        i === 0
          ? sql`'2090-01-01 00:00:00.000001+00'::timestamptz`
          : sql`'2090-01-01 00:00:00.000002+00'::timestamptz`;
      await db.insert(sales).values({
        id: saleIds[i]!,
        storeId: fixture.storeId,
        customerId: customer.id,
        paymentMethod: 'credit',
        totalPaise: 100,
        actorId: fixture.userId,
        createdAt,
      });
      await db.insert(khataEntries).values({
        id: entryIds[i]!,
        storeId: fixture.storeId,
        customerId: customer.id,
        kind: 'sale_debit',
        amountPaise: 100,
        saleId: saleIds[i]!,
        actorId: fixture.userId,
        createdAt,
      });
    }
    let saleCursor: string | null = null,
      ledgerCursor: string | null = null;
    const actualSales: string[] = [],
      actualEntries: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await request(
        'GET',
        path(`/sales?limit=1${saleCursor ? `&cursor=${saleCursor}` : ''}`),
      );
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json<Page<Sale>>();
      actualSales.push(...result.items.map((s) => s.id));
      saleCursor = result.nextCursor;
      const ledger = await request(
        'GET',
        path(
          `/customers/${customer.id}/khata?limit=1${ledgerCursor ? `&cursor=${ledgerCursor}` : ''}`,
        ),
      );
      expect(ledger.statusCode, ledger.body).toBe(200);
      const entries = ledger.json<Page<LedgerEntry> & { balancePaise: number }>();
      expect(entries.balancePaise).toBe(300);
      actualEntries.push(...entries.items.map((e) => e.id));
      ledgerCursor = entries.nextCursor;
    }
    expect(actualSales).toEqual([...saleIds].reverse());
    expect(actualEntries).toEqual([...entryIds].reverse());
    const foreignSale = await one(
      db.select({ id: sales.id }).from(sales).where(ne(sales.storeId, fixture.storeId)).limit(1),
    );
    const foreignCursor = await request('GET', path(`/sales?cursor=${foreignSale.id}`));
    expect(foreignCursor.statusCode, foreignCursor.body).toBe(200);
    expect(foreignCursor.json<Page<Sale>>().items).toEqual([]);
    const otherEntry = await one(
      db
        .select({ id: khataEntries.id })
        .from(khataEntries)
        .where(eq(khataEntries.customerId, fixture.customers.Ramesh!))
        .limit(1),
    );
    const wrongCustomer = await request(
      'GET',
      path(`/customers/${customer.id}/khata?cursor=${otherEntry.id}`),
    );
    expect(wrongCustomer.statusCode, wrongCustomer.body).toBe(200);
    expect(wrongCustomer.json<Page<LedgerEntry>>().items).toEqual([]);
  });

  it('serializes simultaneous checkout retries with the same idempotency key', async () => {
    const q = await quote(fixture.products.Milk!, 1);
    const idem = key();
    const before = await stock(fixture.products.Milk!);
    const results = await Promise.all(
      [1, 2].map(() => request('POST', path('/sales'), { quote: q.quote, confirmed: true }, idem)),
    );
    for (const response of results) expect(response.statusCode, response.body).toBe(200);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    expect((await stock(fixture.products.Milk!)).quantity).toBe(before.quantity - 1);
  });
});
