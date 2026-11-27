# Architecture and database

## Workspace

```text
apps/web/src/
  app/                      # Session, store selection and navigation
  components/               # Shared form fields
  features/
    counter/                # Draft, preview, confirmation and checkout retry
    stock/                  # Inventory and wholesale demand
    khata/                  # Customer ledger and payments
    management/             # Catalog, suppliers, settings and sales history
    receipts/               # QR and minimal public receipt
  lib/                      # API, pagination and durable writes
  voice/                    # Browser speech adapter and alerts
apps/api/src/
  app.ts                    # Injectable Fastify factory
  server.ts                 # Configuration and lifecycle
  lib/                      # Store router, errors, hashing and idempotency
  modules/
    auth/                   # Sessions and invitation acceptance
    stores/                 # Configuration and staff invitations
    catalog/                # Products, suppliers and shared repository
    customers/              # Customer maintenance
    inventory/              # Receiving and adjustments
    sales/                  # Preview and atomic checkout service
    khata/                  # Balances, history and payments
    restock/                # Demand and procurement
    receipts/               # Receipt links and public projection
packages/
  contracts/src/            # Zod schemas, DTOs and exact money arithmetic
  command-parser/src/       # Local deterministic intents
  db/src/schema/            # Drizzle source schema
  db/migrations/            # DDL and append-only audit triggers
  db/scripts/               # Migrate, seed and owner provisioning
tests/e2e/                  # Isolated API and browser journeys
```

Routes validate inputs using shared Zod schemas and orchestrate domain operations. The checkout service owns quote verification and transaction order. Shared repository helpers normalize database rows, scope lookups and lock products/customers. SQL values are parameterized. Drizzle defines schemas/migrations; runtime SQL uses the typed node-postgres `Connection` abstraction, allowing the same queries to be exercised with PGlite and PostgreSQL.

## Schema

Business tables carry `store_id`; composite foreign keys include it to prevent cross-store references. IDs are UUIDs and timestamps are UTC `timestamptz`. Aliases are normalized but may resolve to multiple entities, requiring clarification.

| Domain      | Tables                                                                | Invariants                                                                                           |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Access      | `users`, `stores`, `store_memberships`, `sessions`, `account_invites` | Unique normalized email; owner/staff membership; hashed expiring tokens; single-use invitations.     |
| Catalog     | `suppliers`, `products`, `product_aliases`                            | Store-scoped SKU uniqueness; versioned products; fixed gram/count unit; archiving.                   |
| Stock       | `inventory_balances`, `stock_movements`                               | One nonnegative balance per product; append-only movement for every change.                          |
| Sales       | `sales`, `sale_items`                                                 | Committed records only; snapshot names, variants, units, prices and totals.                          |
| Khata       | `customers`, `customer_aliases`, `khata_entries`                      | One debit per credit sale; immutable payments; derived running balances.                             |
| Demand      | `restock_requests`                                                    | One open request per canonical key; accepted commands increment once; procurement preserves history. |
| Reliability | `idempotency_records`, `receipt_links`                                | Stored write responses; receipt token hashes, expiry and revocation.                                 |

Money uses integer paise in PostgreSQL `bigint`, bounded to JavaScript's safe integer range at API boundaries. Stock uses integer grams or counts. A product's `price_paise` is per `price_quantity` base units. Calculate with `bigint` intermediates, round half a paise up per line, then sum rounded lines. Cooking oil is a packaged count SKU.

Checks reject negative inventory and invalid units, amounts and ledger relationships. Database triggers reject updates/deletes to sales, sale lines, Khata entries and stock movements. Future refunds/corrections need an explicitly designed compensating-entry workflow.

## Transactions and retries

1. Parsing changes a local draft; it never writes stock or credit.
2. Server preview validates products, customer, prices and stock, returning a five-minute HMAC quote bound to user/store, cart, product versions and settings version.
3. Confirmed checkout takes an idempotency key. Its transaction locks store configuration, credit customer if any, and product/balance rows in product-ID order.
4. It revalidates the quote, inserts sale/lines, deducts stock, appends movements and posts the credit debit atomically.
5. Report low stock only on a transition from above threshold to at/below it. Receipt links are issued separately on request.

Customer row locks serialize credit and payments. Receiving/adjustments update balance and movement together. Procurement locks the request, optionally receives catalog stock and closes it atomically.

An advisory transaction lock serializes store/operation/idempotency-key combinations. Store the response inside the transaction; retries return it before quote expiry checks. Another payload with the same key returns `409`. Keep idempotency records in v1.

The browser persists a checkout attempt before sending it. An uncertain response locks the cart across reloads until the original attempt resolves. Stock, payment and demand writes similarly retain body/key and offer explicit retry. No financial operation is replayed automatically in the background.

## Access, speech and offline data

Argon2id protects passwords. Seven-day opaque sessions use HTTP-only, same-site cookies and secure cookies in production. Mutation Origin must match configuration. Owners maintain products/prices, suppliers, settings and stock corrections; staff sell, maintain customers, receive stock, capture demand and settle payments.

Speech starts on merchant activation after the browser-processing notice. Recognition events are deduplicated; transcripts remain editable. Warnings stop recognition before playback. Audio/raw transcripts are excluded from application logs.

IndexedDB stores drafts/catalog snapshots by user/store. Session metadata supports reopening an existing offline session; logout clears active identity, while isolated drafts remain recoverable for that user. The service worker caches only the application shell, never API responses. Offline mode permits draft edits; all business writes require reconnection.

## Deployment

- Configure Supabase PostgreSQL with `DATABASE_URL` and `DATABASE_PASSWORD`, random `QUOTE_SECRET`, exact HTTPS `APP_ORIGIN`, `NODE_ENV=production`, and API `HOST`/`PORT`. Use the exact Session pooler URL from the project's Connect panel on IPv4-only networks. Supabase connections require verified TLS; `sslrootcert` can specify the project's CA certificate.
- Apply `npm run db:migrate` before starting the API. Do not demo-seed a merchant database.
- Run `npm run build`. Serve `apps/web/dist`, proxy `/api` and `/health`, and route browser paths to `index.html`. The API starts with `npm run start --workspace @munim/api`.
- Terminate HTTPS at the public proxy/load balancer. See `deploy/nginx.conf`; keep receipt-token paths out of proxy logs, including public browser receipt pages.
- Keep API responses uncached and preserve receipt no-referrer/no-index headers. Receipt tokens have 256 bits of entropy and seven-day expiry.
- Rate limiting is process-local: use one API instance for the pilot or introduce a shared limiter before scaling.
- Back up PostgreSQL, rehearse restores and monitor readiness/5xx counts. Restrict database credentials. No external deployment or pilot recruitment is performed by the repository.

Tests default to PGlite. Set `TEST_DATABASE_URL` to exercise actual PostgreSQL connections and row locks; the helper creates and drops only its generated test schema. CI configures this mode.

The application uses Supabase as hosted PostgreSQL through the server's `pg` connection pool. It retains its own authentication and Fastify API. All 18 application tables enable row-level security without browser policies, and migrations revoke direct table grants from Supabase's `anon` and `authenticated` roles. The database owner used by the server can access the tables; browser clients must go through Fastify's store authorization. Never expose `DATABASE_URL` or `DATABASE_PASSWORD` in a Vite/browser environment variable.

There is no local application database configuration. The PostgreSQL container in CI is an isolated test service, and the Supabase permission test always runs in an embedded database. Neither test workflow uses the application's `DATABASE_URL`.

Connection setup follows the [Supabase PostgreSQL connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
