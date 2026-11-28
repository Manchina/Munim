import { useState } from 'react';
import type { Customer, LedgerEntry, Page, Sale } from '@munim/contracts';
import { api, inr, decimalAmount } from '../../lib/api';
import { Panel, type ViewProps } from '../../app/App';
import { durableWrite } from '../../lib/mutations';
import { fields, str, paise, Field, Select } from '../../components/Forms';
import { Modal } from '../../components/Modal';
import { formatStockQty } from '../../lib/units';

export function Khata(p: ViewProps) {
  const [customerId, setCustomerId] = useState(''),
    [history, setHistory] = useState<(Page<LedgerEntry> & { balancePaise: number }) | null>(null),
    [sale, setSale] = useState<Sale | null>(null),
    [query, setQuery] = useState(''),
    [addingCustomer, setAddingCustomer] = useState(false),
    [settling, setSettling] = useState(false),
    [payAmount, setPayAmount] = useState('');
  const { data, base, run, offline, busy, refresh, notify } = p;

  async function load(id: string, cursor?: string) {
    const value = await api<Page<LedgerEntry> & { balancePaise: number }>(
      `${base}/customers/${id}/khata${cursor ? `?cursor=${cursor}` : ''}`,
    );
    setHistory((old) =>
      cursor && old ? { ...value, items: [...old.items, ...value.items] } : value,
    );
    if (!cursor) {
      setPayAmount(value.balancePaise > 0 ? decimalAmount(value.balancePaise) : '');
    }
  }

  const q = query.trim().toLowerCase();
  const customers = [...data.balances]
    .sort((a, b) => Number(b.balancePaise > 0) - Number(a.balancePaise > 0))
    .filter((c) => {
      if (!q) return true;
      const meta = data.customers.find((x) => x.id === c.id);
      return `${c.name} ${meta?.phone ?? ''}`.toLowerCase().includes(q);
    });

  return (
    <>
      <div className="two-columns">
        <Panel
          title="Customer balances"
          aside={
            <button
              type="button"
              className="icon-btn"
              aria-label="Add new customer"
              title="Add new customer"
              disabled={offline || busy}
              onClick={() => setAddingCustomer(true)}
            >
              +
            </button>
          }
        >
          <div className="balance-total">
            <small>TOTAL TO COLLECT</small>
            <h2>{inr(data.balances.reduce((a, b) => a + BigInt(b.balancePaise), 0n))}</h2>
          </div>

          <div className="toolbar">
            <input
              type="search"
              placeholder="Search customer or phone…"
              aria-label="Search customer"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="inner-scroll">
            {customers.map((c) => {
              const meta = data.customers.find((x) => x.id === c.id);
              return (
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
                  <span>
                    <strong>{c.name}</strong>
                    {meta?.phone && <small>{meta.phone}</small>}
                  </span>
                  <span>{c.balancePaise > 0 ? inr(c.balancePaise) : 'Settled'}</span>
                  <span>→</span>
                </button>
              );
            })}
          </div>
          {offline && <p>Go online to see full khata history and record payments.</p>}
        </Panel>

        <Panel
          title={data.customers.find((c) => c.id === customerId)?.name ?? 'Khata history'}
          aside={
            history && history.balancePaise > 0 ? (
              <button
                type="button"
                className="primary"
                disabled={offline || busy}
                onClick={() => {
                  setPayAmount(decimalAmount(history.balancePaise));
                  setSettling(true);
                }}
              >
                Settle payment
              </button>
            ) : undefined
          }
        >
          {!history ? (
            <div className="empty compact">
              <h3>A clear record, always.</h3>
              <p>Select a customer to see credit purchases and record payments.</p>
            </div>
          ) : (
            <>
              <h3>Pending · {inr(history.balancePaise)}</h3>
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
            </>
          )}
        </Panel>
      </div>

      <Modal
        open={addingCustomer}
        title="Add new customer"
        onClose={() => setAddingCustomer(false)}
      >
        <form
          className="form-grid"
          onSubmit={(e) => {
            const f = fields(e);
            void run(async () => {
              const created = await api<Customer>(`${base}/customers`, 'POST', {
                name: str(f, 'name'),
                phone: str(f, 'phone') || null,
                aliases: [],
                archived: false,
              });
              setAddingCustomer(false);
              await refresh();
              setCustomerId(created.id);
              setSale(null);
              await load(created.id);
              notify(`Added ${created.name} to Khata.`);
            });
          }}
        >
          <Field name="name" label="Customer name" />
          <Field name="phone" label="Phone number (optional)" required={false} />
          <div className="modal-actions">
            <button type="button" className="quiet" onClick={() => setAddingCustomer(false)}>
              Cancel
            </button>
            <button className="primary" disabled={offline || busy}>
              Save customer
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={settling && Boolean(history)}
        title={`Settle payment · ${data.customers.find((c) => c.id === customerId)?.name ?? ''}`}
        onClose={() => setSettling(false)}
      >
        {history && (
          <form
            className="form-grid"
            onSubmit={(e) => {
              const f = fields(e);
              void run(async () => {
                await durableWrite(
                  `${p.userId}:${data.settings.id}`,
                  `${base}/customers/${customerId}/payments`,
                  {
                    amountPaise: paise(payAmount),
                    method: str(f, 'method'),
                    reference: str(f, 'reference') || null,
                  },
                );
                setSettling(false);
                await load(customerId);
                await refresh();
                notify('Payment recorded.');
              });
            }}
          >
            <label>
              Payment amount (₹)
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </label>
            {history.balancePaise > 0 && (
              <div className="quick-chips">
                <button
                  type="button"
                  onClick={() => setPayAmount(decimalAmount(history.balancePaise))}
                >
                  Full ({inr(history.balancePaise)})
                </button>
                {history.balancePaise >= 10000 && (
                  <button type="button" onClick={() => setPayAmount('100')}>
                    ₹100
                  </button>
                )}
                {history.balancePaise >= 50000 && (
                  <button type="button" onClick={() => setPayAmount('500')}>
                    ₹500
                  </button>
                )}
              </div>
            )}
            <Select name="method" label="Paid by" value="cash">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </Select>
            <Field name="reference" label="Note / UPI ref (optional)" required={false} />
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={() => setSettling(false)}>
                Cancel
              </button>
              <button className="primary" disabled={offline || busy || !history.balancePaise}>
                Confirm payment
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(sale)}
        title={sale ? `Credit purchase · ${inr(sale.totalPaise)}` : ''}
        onClose={() => setSale(null)}
      >
        {sale && (
          <div className="qr-panel">
            {sale.items?.map((i) => (
              <p key={i.productId}>
                {i.name} {i.variant} · {formatStockQty(i.quantity, i.baseUnit)} ·{' '}
                {inr(i.lineTotalPaise)}
              </p>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
