# Pilot acceptance checks

Automated coverage includes parsing/rounding, API transactions/access, duplicate writes, threshold crossings, partial/full payments, restock normalization, receipt privacy/revocation, browser checkout, offline recovery, lost-response retry and a 390px mobile viewport.

Record these manual checks before enrolling merchants:

- Install the production PWA over HTTPS on target phones/tablets; verify icons and offline reopening.
- Activate, deny and revoke microphone permission; stop/restart listening and fall back to editable text.
- Try Hinglish orders with fans, street noise and overlapping voices; unclear speech must never post financial writes.
- Trigger stock alerts while listening and verify app speech never becomes another command.
- Scan a receipt on another device without signing in; check privacy, revoke it and retry.
- Scan a cart UPI code, change the cart and verify the prior code disappears; check merchant payment confirmation.
- Disconnect during checkout, reconnect and retry: exactly one sale, stock deduction and credit debit.
- Verify PostgreSQL backup/restore and run counter/ledger smoke checks on the restored copy.
- Configure local aliases and only validated measure conversions.

Recruit 20–30 stores for 30 days. Establish each store's top-20 staples, prior-month disputes/stockouts and rush-hour sampling windows first. Use sampled counter tallies to include transactions never entered in Munim. Evaluate adoption, correction rate and both revenue-protection measures separately using `plan.md`.

Do not collect raw audio/full transcripts for pilot measurement.
