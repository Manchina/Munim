import { useState } from 'react';
import type { LedgerEntry, Page, Sale } from '@munim/contracts';
import { api, inr, decimalAmount } from '../../lib/api';
import { Panel, type ViewProps } from '../../app/App';
import { durableWrite } from '../../lib/mutations';
import { fields, str, paise, Field, Select } from '../../components/Forms';
export function Khata(p: ViewProps) {
  const [customerId, setCustomerId] = useState(''),
    [history, setHistory] = useState<(Page<LedgerEntry> & { balancePaise: number }) | null>(null),
    [sale, setSale] = useState<Sale | null>(null);
  const { data, base, run, offline, busy, refresh, notify } = p;
  async function load(id: string, cursor?: string) {
    const value = await api<Page<LedgerEntry> & { balancePaise: number }>(
      `${base}/customers/${id}/khata${cursor ? `?cursor=${cursor}` : ''}`,
    );
    setHistory((old) =>
      cursor && old ? { ...value, items: [...old.items, ...value.items] } : value,
    );
  }
  return (
    <div className="two-columns">
      <Panel title="Customer balances">
        <div className="balance-total">
          <small>TOTAL PENDING</small>
          <h2>{inr(data.balances.reduce((a, b) => a + BigInt(b.balancePaise), 0n))}</h2>
        </div>
        {data.balances.map((c) => (
          <button
            className={`customer-row ${customerId === c.id ? 'selected' : ''}`}
            disabled={offline || busy}
            key={c.id}
            onClick={() =>
              void run(async () => {
                setCustomerId(c.id);
                setSale(null);
                await load(c.id);
              })
            }
          >
            <span className="avatar">{c.name.slice(0, 1)}</span>
            <strong>{c.name}</strong>
            <span>{inr(c.balancePaise)}</span>
            <span>→</span>
          </button>
        ))}
        {offline && <p>Reconnect to view current ledger history and record payments.</p>}
      </Panel>
      <Panel title={data.customers.find((c) => c.id === customerId)?.name ?? 'Khata history'}>
        {!history ? (
          <div className="empty compact">
            <h3>A clear record, always.</h3>
            <p>Select a customer to see credit purchases and payments.</p>
          </div>
        ) : (
          <>
            <h3>Pending · {inr(history.balancePaise)}</h3>
            <form
              className="form-grid"
              onSubmit={(e) => {
                const f = fields(e);
                void run(async () => {
                  await durableWrite(
                    `${p.userId}:${data.settings.id}`,
                    `${base}/customers/${customerId}/payments`,
                    {
                      amountPaise: paise(str(f, 'amount')),
                      method: str(f, 'method'),
                      reference: str(f, 'reference') || null,
                    },
                  );
                  await load(customerId);
                  await refresh();
                  notify('Payment recorded.');
                });
              }}
            >
              <Field
                name="amount"
                label="Payment amount (₹)"
                type="number"
                min="0.01"
                step="0.01"
                value={decimalAmount(history.balancePaise)}
              />
              <Select name="method" label="Paid by" value="cash">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </Select>
              <Field name="reference" label="Reference (optional)" required={false} />
              <button className="primary" disabled={offline || busy || !history.balancePaise}>
                Settle payment
              </button>
            </form>
            <div className="ledger-list">
              {history.items.map((entry) => (
                <div className="ledger-row" key={entry.id}>
                  <div>
                    <strong>
                      {entry.kind === 'payment' ? 'Payment received' : 'Credit purchase'}
                    </strong>
                    <small>
                      {new Date(entry.createdAt).toLocaleString('en-IN', {
                        timeZone: data.settings.timezone,
                      })}
                    </small>
                  </div>
                  <strong className={entry.kind === 'payment' ? 'paid' : ''}>
                    {entry.kind === 'payment' ? '−' : '+'}
                    {inr(entry.amountPaise)}
                  </strong>
                  {entry.saleId && (
                    <button
                      disabled={offline || busy}
                      onClick={() =>
                        void run(async () =>
                          setSale(await api<Sale>(`${base}/sales/${entry.saleId}`)),
                        )
                      }
                    >
                      Items
                    </button>
                  )}
                </div>
              ))}
            </div>
            {history.nextCursor && (
              <button
                disabled={offline || busy}
                onClick={() => void run(() => load(customerId, history.nextCursor!))}
              >
                Load more history
              </button>
            )}
            {sale && (
              <div className="qr-panel">
                <h3>Credit purchase · {inr(sale.totalPaise)}</h3>
                {sale.items?.map((i) => (
                  <p key={i.productId}>
                    {i.name} {i.variant} · {i.quantity} {i.baseUnit} · {inr(i.lineTotalPaise)}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
