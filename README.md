# Munim | Voice-First Kirana OS

Munim is a planned progressive web app for independent kirana and provision stores across Tier 1–3 Indian cities and towns. It lets shopkeepers record sales, udhaar (customer credit), and requests for missing stock while they weigh and pack groceries.

At a busy counter, a barcode scanner is little help with loose dal, rice, sugar, and local bakery goods. Typing can mean putting down the scoop, wiping your hands, and holding up the queue. When the fallback is mental arithmetic and paper slips, credit can go unrecorded, staples can run out unexpectedly, and customer requests can be forgotten before the next wholesale trip.

**Project status:** Planning. The application has yet to be scaffolded.

## The counter experience

The high-contrast mobile and tablet interface has three views: **Live Counter**, **Stock & Restock List**, and **Khata Credit Ledger**. A persistent microphone bar offers live Web Speech API capture, an editable transcript that doubles as a text simulator, and clickable sample command chips. Each input uses the same command parser.

| Workflow | What the shopkeeper can do |
| --- | --- |
| Build and check out a sale | Say “1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet” to add items and see INR line totals. Confirm checkout to record the sale and deduct stock. |
| Catch low stock | See a prominent badge at or below an item's safety threshold. Hear a chime and spoken warning when a committed sale first takes the item to that level. |
| Capture unmet demand | Say “Amul butter 500g nahi hai, restock list mein daal do.” The Wholesale Restock List records the requested variant and counts repeat requests for the next procurement run. |
| Record and settle udhaar | Say “Ramesh bhai ke khate mein likh do” to finalize the cart as an itemized credit sale. The customer's Khata profile shows the timestamp, pending balance, and a **Settle Payment** action. |

When a customer asks, **Share QR Bill** opens an itemized preview and makes the digital receipt available via QR after checkout. For an unpaid cart, the same on-demand flow can show an amount-specific UPI QR if the merchant has configured a payee. The merchant confirms payment at checkout. Bills are shared digitally on request, with no automatic generation or printing.

The demo will seed 12 grocery products with representative INR prices, two products just above their low-stock thresholds, and two customers with existing credit balances.

## Technology

- **Client:** React and TypeScript with Tailwind CSS, packaged as an installable PWA.
- **API:** Node.js and Fastify with TypeScript.
- **Data:** PostgreSQL with Drizzle ORM for the schema and migrations.
- **Voice:** Web Speech API and a local, rule-based intent parser. The first release targets Hinglish and English, including supported measures such as `aadha kilo` and `pav`. Telugu-English and store-specific measures such as `ser` will be validated during pilot preparation.

Rush-hour noise and overlapping speech are the main product risks. Munim will start with merchant-activated listening, visible transcripts, and confirmation for ambiguous or high-value credit commands. Voice availability and network needs depend on the browser's speech service. Text entry stays available, and the PWA will preserve an in-progress cart during a connection drop. Checkout and ledger changes require a connection. [Web Speech API specification](https://webaudio.github.io/web-speech-api/#cloud-based-vs-on-device-implementations)

## Pilot goals

Run a 30-day pilot in 20–30 stores, focusing on morning and evening rush hours.

- **Adoption:** Log at least 75% of eligible udhaar and loose-item orders by voice without a paper fallback.
- **Accuracy:** Keep voice entries needing a manual edit, retry, or undo below 10%.
- **Revenue protection:** Reduce unrecorded-credit disputes and unexpected stockouts of top-20 staples by at least 50% versus each store's prior month.

[Implementation plan](plan.md) · [MIT license](LICENSE)
