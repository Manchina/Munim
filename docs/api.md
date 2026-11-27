# API contracts

All routes begin `/api/v1`. Store-relative routes below use `/stores/:storeId` and require session authentication and membership. Mutations require an `Origin` matching `APP_ORIGIN`. Shared Zod schemas in `packages/contracts/src/index.ts` define all body fields and defaults.

Mutations return `200`. Lists return `{ items, nextCursor }`; pass `limit` (default 50, maximum 100) and `cursor`. Sales/ledger histories are newest first; entity lists use stable UUID order. Money is integer paise; quantities are integer base units.

Errors: `{ error: { code, message, fieldErrors? }, requestId }`. Status codes: `400` invalid shape/key, `401` sign-in required, `403` role/origin rejected, `404` unavailable/out-of-store resource, `409` conflicts or stale versions/quotes, `422` invalid domain operation, `429` rate limit.

## Authentication

| Method | Path                           | Contract                                                                                                     |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/login` (public)         | `{ email, password }`; sets seven-day session cookie.                                                        |
| POST   | `/auth/logout`                 | Revokes session and clears cookie.                                                                           |
| GET    | `/auth/me`                     | `{ id, email, stores: [{ storeId, name, role }] }`.                                                          |
| POST   | `/auth/accept-invite` (public) | `{ token, password? }`; new accounts set a password; existing accounts sign in with the invited email first. |
| POST   | `/stores/:storeId/invites`     | Owner: `{ email }`; returns `{ id, url }`, valid for two days.                                               |

Operator CLI `npm run db:invite -- email "Store name"` provisions a fresh store/owner invitation. No public signup, SMS or email delivery exists.

## Catalog and settings

| Method      | Store-relative path      | Operation                                                   |
| ----------- | ------------------------ | ----------------------------------------------------------- |
| GET / PATCH | `/settings`              | Read; owner updates with `expectedVersion`.                 |
| GET / POST  | `/products`              | Search/list; owner creates with opening stock.              |
| GET / PATCH | `/products/:productId`   | Read; owner edits/archives with `expectedVersion`.          |
| GET / POST  | `/suppliers`             | List; owner creates.                                        |
| PATCH       | `/suppliers/:supplierId` | Owner edits/archives.                                       |
| GET / POST  | `/customers`             | Search/list and create.                                     |
| GET / PATCH | `/customers/:customerId` | Read, edit contact/aliases; archive only with zero balance. |

Products accept `{ name, variant, sku, baseUnit, priceQuantity, pricePaise, safetyStock, supplierId, aliases, openingStock }`. Updates omit `openingStock` and add `{ expectedVersion, archived }`. A base unit cannot change after creation. Opening stock and its movement commit together.

Customers accept `{ name, phone, aliases, archived }`; suppliers accept `{ name, phone, archived }`. Product/customer aliases are string arrays. Product/customer/supplier lists support `q`. Archived entities leave active lists; v1 has no restore screen.

Settings accept `{ name, creditConfirmationThresholdPaise, pavGrams, upiPayee, upiName, expectedVersion }`. Optional settings are explicitly nullable. Default credit threshold: ₹1,000; `pavGrams` remains unset until configured. INR and Asia/Kolkata are release defaults.

## Inventory and restock

All POSTs in this section require `Idempotency-Key`: 16–100 letters/digits, `_` or `-`. Generate one UUID per merchant action and retain it for retries.

| Method | Store-relative path                    | Contract                                                                                             |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/inventory`                           | Quantities and `lowStock` at/below safety stock.                                                     |
| POST   | `/inventory/receipts`                  | `{ items: [{ productId, quantity }] }`.                                                              |
| POST   | `/inventory/adjustments`               | Owner: `{ productId, delta, reason }`; nonzero signed correction.                                    |
| GET    | `/restock-requests`                    | Filter `status=open\|procured`; includes supplier IDs and counts.                                    |
| POST   | `/restock-requests`                    | `{ productId?, name, variant?, supplierId? }`; increments demand once per accepted action.           |
| POST   | `/restock-requests/:requestId/procure` | `{ quantityReceived }`; zero closes without receiving; positive quantity requires a catalog product. |

Unknown demand normalizes case/whitespace and equivalent size units (`500 g`/`500g`, `1kg`/`1000g`) while keeping distinct variants separate. Catalog demand uses product ID. Procurement preserves history; later demand opens a new request.

## Sales

| Method | Store-relative path | Contract                                                                                                                       |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/sales/preview`    | Cart → canonical lines, `totalPaise`, `requiresCreditConfirmation`, `quote`, `expiresAt` (epoch milliseconds).                 |
| POST   | `/sales`            | `{ quote, confirmed: true }` plus `Idempotency-Key` → completed sale, snapshot items and crossing product names in `lowStock`. |
| GET    | `/sales`            | Completed sale history.                                                                                                        |
| GET    | `/sales/:saleId`    | Completed sale and item snapshots.                                                                                             |

Cart example (replace placeholder IDs with UUIDs):

```json
{
  "items": [{ "productId": "product-uuid", "quantity": 500 }],
  "paymentMethod": "credit",
  "customerId": "customer-uuid"
}
```

Methods: `cash`, `upi`, `credit`. Credit requires a customer and positive total; UPI requires a configured payee. Preview never mutates business data. Quotes expire after five minutes and bind user/store, cart, product prices/versions and configuration.

After a definitive quote conflict, request and confirm a new preview using a new action key. After an uncertain response, retry the original quote/key first: an already committed sale is recoverable after quote expiry. Scanning a payment QR never marks a sale paid; the merchant must confirm receipt. High-value credit gets a prominent confirmation warning.

## Khata

| Method | Store-relative path               | Contract                                                                                                          |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/khata`                          | Customer IDs/names and `balancePaise`.                                                                            |
| GET    | `/customers/:customerId/khata`    | `{ balancePaise, items, nextCursor }`; entries retain timestamps and linked sale IDs.                             |
| POST   | `/customers/:customerId/payments` | `{ amountPaise, method: "cash"\|"upi", reference? }` plus `Idempotency-Key`; returns entry and remaining balance. |

Payments must be positive and no larger than the current balance. They append immutable entries without touching inventory. Customer row locks serialize credit/payments.

## QR sharing

| Method | Path                                                   | Contract                                                     |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| POST   | `/stores/:storeId/sales/:saleId/receipt-links`         | Create `{ id, url, expiresAt }` on demand; seven-day expiry. |
| DELETE | `/stores/:storeId/sales/:saleId/receipt-links/:linkId` | Revoke one link.                                             |
| GET    | `/receipts/:token` (public)                            | Minimal public receipt.                                      |

Public data contains `storeName`, `createdAt`, `totalPaise`, `paymentStatus`, and snapshot items without internal IDs. Credit receipts say `credit_at_checkout`; later customer payments are not attributed to individual receipts. Cash/UPI receipts say `merchant_confirmed_paid`. No customer identity, balances or ledger details. Invalid/expired/revoked tokens return `404`.

Browser receipt URLs use `/receipt/:token`; invitations use `/invite#token`. Locally generated cart UPI codes use the current preview amount and `cu=INR`, and disappear when the cart changes. They are separate from public receipt links.

Public health endpoints outside the API prefix: `GET /health/live` and database-backed `GET /health/ready`.
