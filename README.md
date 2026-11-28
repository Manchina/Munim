# Munim | Voice-First Kirana OS

Munim is a planned progressive web app for independent kirana and provision stores across Tier 1–3 Indian cities and towns. It lets shopkeepers record sales, udhaar (customer credit), and requests for missing stock while they weigh and pack groceries.

At a busy counter, a barcode scanner is little help with loose dal, rice, sugar, and local bakery goods. Typing can mean putting down the scoop, wiping your hands, and holding up the queue. When the fallback is mental arithmetic and paper slips, credit can go unrecorded, staples can run out unexpectedly, and customer requests can be forgotten before the next wholesale trip.

**Project status:** Implemented pilot application. Includes the React PWA, Fastify API, shared parser, PostgreSQL schema/migrations, demo seed, and automated checks. Live-device speech/noise testing and the store pilot remain pending.

## The counter experience

The high-contrast mobile and tablet interface has three views: **Live Counter**, **Stock & Restock List**, and **Khata Credit Ledger**. In Live Counter, start a voice session once and address commands to “Munim.” Browser speech recognition transcribes the command, and the optional OpenAI agent rewrites it for the same parser used by typed commands and sample chips.

| Workflow                   | What the shopkeeper can do                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build and check out a sale | Say “1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet” to add items and see INR line totals. Confirm checkout to record the sale and deduct stock.                                      |
| Catch low stock            | See a prominent badge at or below an item's safety threshold. Hear a chime and spoken warning when a committed sale first takes the item to that level.                                      |
| Capture unmet demand       | Say “Amul butter 500g nahi hai, restock list mein daal do.” The Wholesale Restock List records the requested variant and counts repeat requests for the next procurement run.                |
| Record and settle udhaar   | Say “Ramesh bhai ke khate mein likh do” to finalize the cart as an itemized credit sale. The customer's Khata profile shows the timestamp, pending balance, and a **Settle Payment** action. |

When a customer asks, **Share QR Bill** opens an itemized preview and makes the digital receipt available via QR after checkout. For an unpaid cart, the same on-demand flow can show an amount-specific UPI QR if the merchant has configured a payee. The merchant confirms payment at checkout. Bills are shared digitally on request, with no automatic generation or printing.

The demo seeds 12 grocery products with representative INR prices, two products just above their low-stock thresholds, and two customers with existing credit balances.

## Technology

- **Client:** React and TypeScript with Tailwind CSS, packaged as an installable PWA.
- **API:** Node.js and Fastify with TypeScript.
- **Data:** Supabase PostgreSQL with Drizzle ORM for the schema and migrations.
- **Voice:** Web Speech API and a local, rule-based intent parser. The first release targets Hinglish and English, including supported measures such as `aadha kilo` and `pav`. Telugu-English and store-specific measures such as `ser` will be validated during pilot preparation.

Rush-hour noise and overlapping speech are the main product risks. Munim will start with merchant-activated listening, visible transcripts, and confirmation for ambiguous or high-value credit commands. Voice availability and network needs depend on the browser's speech service. Text entry stays available, and the PWA will preserve an in-progress cart during a connection drop. Checkout and ledger changes require a connection. [Web Speech API specification](https://webaudio.github.io/web-speech-api/#cloud-based-vs-on-device-implementations)

## Pilot goals

Run a 30-day pilot in 20–30 stores, focusing on morning and evening rush hours.

- **Adoption:** Log at least 75% of eligible udhaar and loose-item orders by voice without a paper fallback.
- **Accuracy:** Keep voice entries needing a manual edit, retry, or undo below 10%.
- **Revenue protection:** Reduce unrecorded-credit disputes and unexpected stockouts of top-20 staples by at least 50% versus each store's prior month.

## Run locally

Requires Node.js 22.12+, npm 10+, and a Supabase PostgreSQL project. The app does not require a local database or Docker.

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env`: copy the PostgreSQL connection URL from Supabase's **Connect** panel into `DATABASE_URL`, then set `DATABASE_PASSWORD` to your database password. A password already embedded in the URL takes precedence. Use the **Session pooler** connection when your network cannot reach the direct IPv6 endpoint; copy its exact hostname and `postgres.<project-ref>` username from the dashboard. Connections to Supabase enforce TLS certificate/hostname verification. If your project requires its downloadable CA certificate, append `&sslrootcert=/absolute/path/to/project-ca.crt` to the URL.

Set a random `QUOTE_SECRET` of at least 32 characters. For a fresh demo database only, set `SEED_EMAIL` and a `SEED_PASSWORD` of at least 12 characters. Keep `APP_ORIGIN=http://localhost:5173` for local development. The API binds to `127.0.0.1:3000`; Vite proxies browser API calls. Database credentials stay on the server; this integration does not use a browser Supabase key or replace Munim's existing account/session system.

```powershell
npm run db:migrate
npm run db:seed
npm run dev
```

Run the seed only for a new demo store; omit it when restoring existing merchant data. Open [the local counter](http://localhost:5173) and sign in with your seeded credentials. Seed refuses to overwrite existing accounts. It creates 12 products, two customers with itemized credit history, and Toor dal/Bread just above safety thresholds. There is no default production login.

For a fresh store without demo data, create an owner invitation:

```powershell
npm run db:invite -- owner@example.com "My Kirana"
```

Share the printed link privately; it expires after two days. Owners invite staff from **Manage Store**. Existing account holders sign in before accepting another store's invitation.

## Run the hands-free demo

Set `OPENAI_API_KEY` in the root `.env` and restart `npm run dev`. `OPENAI_MODEL` defaults to `gpt-5-mini`. On a phone, serve Munim over HTTPS and keep Live Counter open in the foreground. Tap **Start voice session** and grant microphone access.

1. Say “Munim, aadha kilo rice aur do Lifebuoy sabun.” Check the cart and listen to the added quantities.
2. Say “Munim, Ramesh bhai ke khate mein likh do.” After Munim reads back the total and the customer, say “Munim, confirm credit” within 30 seconds.
3. Check the completed sale, stock, and Ramesh’s Khata. To record a paid sale, ask for cash or UPI checkout and say “Munim, confirm payment received” after checking that payment has arrived.

To demo Wispr Flow, focus **Command transcript**, dictate with the Wispr app installed on the device, then tap **Use command**. The same box accepts keyboard dictation, typing, and pasted text. Submitted text uses the OpenAI agent when available. OpenAI outages fall back to Munim’s local parser, and offline input can still edit the cart draft. For checkout from the text box, review and confirm on screen.

If the browser’s speech service fails, click **Record command**, speak one command, then click **Transcribe recording** to send the clip to OpenAI. Review the resulting text and click **Use command**. The clip is capped at 12 seconds in the browser and stays on your device until you choose to transcribe it.

## Checks and production build

```powershell
npm run typecheck
npm test
npm run build
npm exec -- playwright install chromium
npm run test:e2e
npm run format:check
```

Unit/API tests use isolated in-memory PGlite PostgreSQL by default and need no Docker. To exercise real PostgreSQL row locks and concurrent connections, set `TEST_DATABASE_URL` to a disposable test database before running `npm test`. Tests create and remove their own randomly named schema. CI configures this PostgreSQL-backed mode.

`npm run test:e2e` builds the PWA and starts isolated API/web servers on ports 3000 and 5173; stop development servers first. Browser credentials and data are test-only.

Production outputs are `apps/web/dist` and `apps/api/dist`. Run `npm run start --workspace @munim/api` with production environment values. Serve the web output and proxy `/api` and `/health` through the same HTTPS origin. See [deployment notes](docs/architecture.md#deployment) and [proxy example](deploy/nginx.conf).

[Architecture and schema](docs/architecture.md) · [API contracts](docs/api.md) · [Pilot checks](docs/pilot-checklist.md) · [Implementation plan](plan.md) · [MIT license](LICENSE)
