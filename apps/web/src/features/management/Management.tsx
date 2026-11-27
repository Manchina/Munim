import { useState } from 'react';
import type { Page, Sale } from '@munim/contracts';
import { api, inr, decimalAmount } from '../../lib/api';
import { Panel, type ViewProps } from '../../app/App';
import { durableWrite } from '../../lib/mutations';
import { QR } from '../receipts/Receipt';
import { fields, str, num, paise, aliasList, Field, Select } from '../../components/Forms';
export function Maintenance(p: ViewProps) {
  const { data, owner, offline, busy, run, base, refresh, notify } = p;
  const [productId, setProductId] = useState(''),
    [customerId, setCustomerId] = useState(''),
    [supplierId, setSupplierId] = useState(''),
    [invite, setInvite] = useState('');
  const selected = data.products.find((p) => p.id === productId),
    selectedCustomer = data.customers.find((c) => c.id === customerId),
    selectedSupplier = data.suppliers.find((s) => s.id === supplierId);
  return (
    <div className="management-grid">
      {owner && (
        <Panel title="Product catalog">
          <label>
            Edit product
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Create a product</option>
              {data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.variant}
                </option>
              ))}
            </select>
          </label>
          <form
            className="form-grid"
            key={productId + (selected?.version ?? '')}
            onSubmit={(e) => {
              const f = fields(e);
              void run(async () => {
                const body = {
                  name: str(f, 'name'),
                  variant: str(f, 'variant'),
                  sku: str(f, 'sku') || null,
                  baseUnit: str(f, 'baseUnit'),
                  priceQuantity: num(f, 'priceQuantity'),
                  pricePaise: paise(str(f, 'price')),
                  safetyStock: num(f, 'safetyStock'),
                  supplierId: str(f, 'supplierId') || null,
                  aliases: aliasList(f),
                };
                await api(
                  `${base}/products${selected ? `/${selected.id}` : ''}`,
                  selected ? 'PATCH' : 'POST',
                  {
                    ...body,
                    ...(selected
                      ? { expectedVersion: selected.version, archived: f.has('archived') }
                      : { openingStock: num(f, 'openingStock') }),
                  },
                );
                await refresh();
                notify('Product saved.');
              });
            }}
          >
            <Field name="name" label="Product name" value={selected?.name} />
            <Field
              name="variant"
              label="Variant / pack size"
              value={selected?.variant}
              required={false}
            />
            <Field name="sku" label="SKU (optional)" value={selected?.sku} required={false} />
            <Select name="baseUnit" label="Stock unit" value={selected?.baseUnit ?? 'each'}>
              <option value="each">Count / packaged item</option>
              <option value="gram">Grams / loose goods</option>
            </Select>
            <Field
              name="priceQuantity"
              label="Price is per how many base units?"
              type="number"
              min="1"
              step="1"
              value={selected?.priceQuantity ?? 1}
            />
            <Field
              name="price"
              label="Price (₹)"
              type="number"
              step="0.01"
              value={selected ? decimalAmount(selected.pricePaise) : undefined}
            />
            <Field
              name="safetyStock"
              label="Safety stock (base units)"
              type="number"
              step="1"
              value={selected?.safetyStock ?? 0}
            />
            {!selected && (
              <Field
                name="openingStock"
                label="Opening stock (base units)"
                type="number"
                step="1"
                value={0}
              />
            )}
            <Select name="supplierId" label="Supplier" value={selected?.supplierId}>
              <option value="">Unassigned</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Field
              name="aliases"
              label="Voice aliases (comma separated)"
              value={selected?.aliases.join(', ')}
              required={false}
            />
            {selected && (
              <label className="check">
                <input name="archived" type="checkbox" />
                Archive this product
              </label>
            )}
            <button disabled={busy || offline}>
              {selected ? 'Save product' : 'Create product'}
            </button>
          </form>
        </Panel>
      )}
      <Panel title="Customers">
        <label>
          Edit customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Create a customer</option>
            {data.customers.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <form
          className="form-grid"
          key={customerId}
          onSubmit={(e) => {
            const f = fields(e);
            void run(async () => {
              await api(
                `${base}/customers${customerId ? `/${customerId}` : ''}`,
                customerId ? 'PATCH' : 'POST',
                {
                  name: str(f, 'name'),
                  phone: str(f, 'phone') || null,
                  aliases: aliasList(f),
                  archived: f.has('archived'),
                },
              );
              await refresh();
              notify('Customer saved.');
            });
          }}
        >
          <Field name="name" label="Customer name" value={selectedCustomer?.name} />
          <Field
            name="phone"
            label="Phone (optional)"
            value={selectedCustomer?.phone}
            required={false}
          />
          <Field
            name="aliases"
            label="Name aliases (comma separated)"
            value={selectedCustomer?.aliases.join(', ')}
            required={false}
          />
          {customerId && (
            <label className="check">
              <input name="archived" type="checkbox" />
              Archive after settling balance
            </label>
          )}
          <button disabled={offline || busy}>Save customer</button>
        </form>
      </Panel>
      {owner && (
        <>
          <Panel title="Suppliers">
            <label>
              Edit supplier
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Create a supplier</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              className="form-grid"
              key={supplierId}
              onSubmit={(e) => {
                const f = fields(e);
                void run(async () => {
                  await api(
                    `${base}/suppliers${supplierId ? `/${supplierId}` : ''}`,
                    supplierId ? 'PATCH' : 'POST',
                    {
                      name: str(f, 'name'),
                      phone: str(f, 'phone') || null,
                      archived: f.has('archived'),
                    },
                  );
                  await refresh();
                  notify('Supplier saved.');
                });
              }}
            >
              <Field name="name" label="Supplier name" value={selectedSupplier?.name} />
              <Field
                name="phone"
                label="Phone (optional)"
                required={false}
                value={selectedSupplier?.phone}
              />
              {supplierId && (
                <label className="check">
                  <input name="archived" type="checkbox" />
                  Archive supplier
                </label>
              )}
              <button disabled={offline || busy}>Save supplier</button>
            </form>
          </Panel>
          <Panel title="Store settings">
            <form
              className="form-grid"
              key={data.settings.settingsVersion}
              onSubmit={(e) => {
                const f = fields(e);
                void run(async () => {
                  await api(`${base}/settings`, 'PATCH', {
                    name: str(f, 'name'),
                    creditConfirmationThresholdPaise: paise(str(f, 'threshold')),
                    pavGrams: str(f, 'pav') ? num(f, 'pav') : null,
                    upiPayee: str(f, 'upi') || null,
                    upiName: str(f, 'upiName') || null,
                    expectedVersion: data.settings.settingsVersion,
                  });
                  await refresh();
                  notify('Store settings saved.');
                });
              }}
            >
              <Field name="name" label="Store name" value={data.settings.name} />
              <Field
                name="threshold"
                label="Extra credit confirmation above (₹)"
                type="number"
                step="0.01"
                value={decimalAmount(data.settings.creditConfirmationThresholdPaise)}
              />
              <Field
                name="pav"
                label="Store measure: pav in grams (optional)"
                type="number"
                min="1"
                step="1"
                required={false}
                value={data.settings.pavGrams}
              />
              <Field
                name="upi"
                label="UPI payee address (optional)"
                required={false}
                value={data.settings.upiPayee}
              />
              <Field
                name="upiName"
                label="UPI payee name"
                required={false}
                value={data.settings.upiName}
              />
              <button disabled={offline || busy}>Save settings</button>
            </form>
          </Panel>
          <Panel title="Staff invitations">
            <form
              className="form-grid"
              onSubmit={(e) => {
                const f = fields(e);
                void run(async () => {
                  const result = await api<{ url: string }>(`${base}/invites`, 'POST', {
                    email: str(f, 'email'),
                  });
                  setInvite(result.url);
                });
              }}
            >
              <Field name="email" label="Staff email" type="email" />
              <button disabled={offline || busy}>Create private invitation</button>
            </form>
            {invite && (
              <>
                <p>Share this link privately. It expires in 2 days.</p>
                <input
                  aria-label="Invitation link"
                  value={invite}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </>
            )}
          </Panel>
          <Panel title="Stock correction">
            <p>
              Use this for counted differences, spoilage or damage. Sales are recorded at the
              counter.
            </p>
            <form
              className="form-grid"
              onSubmit={(e) => {
                const f = fields(e);
                void run(async () => {
                  await durableWrite(
                    `${p.userId}:${data.settings.id}`,
                    `${base}/inventory/adjustments`,
                    {
                      productId: str(f, 'productId'),
                      delta: num(f, 'delta'),
                      reason: str(f, 'reason'),
                    },
                  );
                  await refresh();
                  notify('Stock correction recorded.');
                });
              }}
            >
              <Select name="productId" label="Product">
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.baseUnit})
                  </option>
                ))}
              </Select>
              <Field
                name="delta"
                label="Change in base units (negative to deduct)"
                type="number"
                min="-2000000000"
                step="1"
              />
              <Field name="reason" label="Reason" />
              <button disabled={offline || busy}>Record correction</button>
            </form>
          </Panel>
        </>
      )}
      <SalesHistory {...p} />
    </div>
  );
}
function SalesHistory(p: ViewProps) {
  const [sales, setSales] = useState<Page<Sale> | null>(null),
    [sale, setSale] = useState<Sale | null>(null),
    [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const { run, base, offline, busy } = p;
  return (
    <Panel title="Completed sales">
      <button
        disabled={offline || busy}
        onClick={() => void run(async () => setSales(await api(`${base}/sales`)))}
      >
        Load recent sales
      </button>
      {sales?.items.map((s) => (
        <button
          className="customer-row"
          key={s.id}
          disabled={offline || busy}
          onClick={() =>
            void run(async () => {
              setSale(await api(`${base}/sales/${s.id}`));
              setLink(null);
            })
          }
        >
          <span>
            {new Date(s.createdAt).toLocaleString('en-IN', { timeZone: p.data.settings.timezone })}
          </span>
          <strong>{inr(s.totalPaise)}</strong>
          <span>{s.paymentMethod}</span>
        </button>
      ))}
      {sales?.nextCursor && (
        <button
          disabled={offline || busy}
          onClick={() =>
            void run(async () => {
              const more = await api<Page<Sale>>(`${base}/sales?cursor=${sales.nextCursor}`);
              setSales({ ...more, items: [...sales.items, ...more.items] });
            })
          }
        >
          Load more sales
        </button>
      )}
      {sale && (
        <div className="qr-panel">
          <h3>Sale · {inr(sale.totalPaise)}</h3>
          {sale.items?.map((i) => (
            <p key={i.productId}>
              {i.name} {i.variant} · {i.quantity} {i.baseUnit} · {inr(i.lineTotalPaise)}
            </p>
          ))}
          <button
            disabled={offline || busy}
            onClick={() =>
              void run(async () =>
                setLink(await api(`${base}/sales/${sale.id}/receipt-links`, 'POST')),
              )
            }
          >
            Share receipt QR
          </button>
          {link && (
            <>
              <QR value={link.url} label="Open this sale receipt" />
              <a href={link.url} target="_blank" rel="noreferrer">
                Open receipt
              </a>
              <button
                disabled={offline || busy}
                onClick={() =>
                  void run(async () => {
                    await api(`${base}/sales/${sale.id}/receipt-links/${link.id}`, 'DELETE');
                    setLink(null);
                  })
                }
              >
                Revoke this link
              </button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
