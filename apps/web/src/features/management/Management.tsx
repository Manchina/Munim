import { useEffect, useState } from 'react';
import type { Page, Product, Sale } from '@munim/contracts';
import { api, inr, decimalAmount } from '../../lib/api';
import { requestSaleBillQr, type BillQrLink } from '../../lib/qr';
import { Panel, type ViewProps } from '../../app/App';
import { fields, str, num, paise, aliasList, Field, Select } from '../../components/Forms';
import { Modal } from '../../components/Modal';
import {
  formatStockQty,
  formatUnitPrice,
  fromBaseUnits,
  toBaseUnits,
  type BaseUnit,
} from '../../lib/units';

type ManageTab = 'items' | 'sales' | 'contacts' | 'store';

export function Maintenance(p: ViewProps) {
  const { data, owner, offline, busy, run, base, refresh, notify } = p;
  const [tab, setTab] = useState<ManageTab>(owner ? 'items' : 'sales');
  const [itemQuery, setItemQuery] = useState('');
  const [editingItem, setEditingItem] = useState<Product | 'new' | null>(null);
  const [sellBy, setSellBy] = useState<BaseUnit>('each');

  const [editingSupplier, setEditingSupplier] = useState<
    { id: string; name: string; phone: string | null } | 'new' | null
  >(null);
  const [editingCustomer, setEditingCustomer] = useState<
    (typeof data.customers)[number] | 'new' | null
  >(null);
  const [invite, setInvite] = useState('');

  function openItemModal(item: Product | 'new') {
    setEditingItem(item);
    setSellBy(item === 'new' ? 'each' : item.baseUnit);
  }

  const iq = itemQuery.trim().toLowerCase();
  const filteredItems = data.products.filter((prod) =>
    !iq ? true : `${prod.name} ${prod.variant}`.toLowerCase().includes(iq),
  );

  const selectedProduct = editingItem && editingItem !== 'new' ? editingItem : null;
  const unitLabel = sellBy === 'gram' ? 'kg' : 'pcs';

  return (
    <div>
      <div className="subnav" role="tablist" aria-label="Manage store sections">
        {owner && (
          <button
            role="tab"
            aria-selected={tab === 'items'}
            className={tab === 'items' ? 'primary' : ''}
            onClick={() => setTab('items')}
          >
            Items
          </button>
        )}
        <button
          role="tab"
          aria-selected={tab === 'sales'}
          className={tab === 'sales' ? 'primary' : ''}
          onClick={() => setTab('sales')}
        >
          Past bills
        </button>
        <button
          role="tab"
          aria-selected={tab === 'contacts'}
          className={tab === 'contacts' ? 'primary' : ''}
          onClick={() => setTab('contacts')}
        >
          {owner ? 'Wholesalers & Customers' : 'Customers'}
        </button>
        {owner && (
          <button
            role="tab"
            aria-selected={tab === 'store'}
            className={tab === 'store' ? 'primary' : ''}
            onClick={() => setTab('store')}
          >
            Store & Staff
          </button>
        )}
      </div>

      {tab === 'items' && owner && (
        <Panel
          title="Store items"
          aside={
            <button
              type="button"
              className="primary"
              disabled={offline || busy}
              onClick={() => openItemModal('new')}
            >
              + Add item
            </button>
          }
        >
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search items…"
              aria-label="Search store items"
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
            />
          </div>
          <div className="stock-list">
            {filteredItems.map((prod) => (
              <div className="stock-row" key={prod.id}>
                <div className="stock-row-main">
                  <div>
                    <strong>{prod.name}</strong>
                    {prod.variant && <small>{prod.variant}</small>}
                  </div>
                  <div className="stock-row-right">
                    <span className="stock-qty">
                      {formatUnitPrice(prod.pricePaise, prod.priceQuantity, prod.baseUnit)}
                    </span>
                    <small>· {formatStockQty(prod.quantity, prod.baseUnit)}</small>
                  </div>
                  <button
                    type="button"
                    disabled={offline || busy}
                    onClick={() => openItemModal(prod)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'sales' && <SalesHistory {...p} />}

      {tab === 'contacts' && (
        <div className="two-columns">
          {owner && (
            <Panel
              title="Wholesalers"
              aside={
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Add wholesaler"
                  title="Add wholesaler"
                  disabled={offline || busy}
                  onClick={() => setEditingSupplier('new')}
                >
                  +
                </button>
              }
            >
              <div className="inner-scroll">
                {data.suppliers.map((s) => (
                  <button
                    type="button"
                    className="customer-row"
                    key={s.id}
                    disabled={offline || busy}
                    onClick={() => setEditingSupplier(s)}
                  >
                    <span className="avatar">{s.name.slice(0, 1)}</span>
                    <span>
                      <strong>{s.name}</strong>
                      {s.phone && <small>{s.phone}</small>}
                    </span>
                    <span>Edit</span>
                    <span>→</span>
                  </button>
                ))}
                {!data.suppliers.length && (
                  <div className="empty compact">
                    <h3>No wholesalers yet</h3>
                    <p>Tap + above to add a wholesaler.</p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel
            title="Customers"
            aside={
              <button
                type="button"
                className="icon-btn"
                aria-label="Add customer"
                title="Add customer"
                disabled={offline || busy}
                onClick={() => setEditingCustomer('new')}
              >
                +
              </button>
            }
          >
            <div className="inner-scroll">
              {data.customers.map((c) => (
                <button
                  type="button"
                  className="customer-row"
                  key={c.id}
                  disabled={offline || busy}
                  onClick={() => setEditingCustomer(c)}
                >
                  <span className="avatar">{c.name.slice(0, 1)}</span>
                  <span>
                    <strong>{c.name}</strong>
                    {c.phone && <small>{c.phone}</small>}
                  </span>
                  <span>Edit</span>
                  <span>→</span>
                </button>
              ))}
              {!data.customers.length && (
                <div className="empty compact">
                  <h3>No customers yet</h3>
                  <p>Tap + above to add a customer.</p>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'store' && owner && (
        <div className="two-columns">
          <Panel title="Store & UPI">
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
              <Field name="name" label="Shop name" value={data.settings.name} />
              <Field
                name="upi"
                label="Your UPI ID (optional, e.g. shop@upi)"
                required={false}
                value={data.settings.upiPayee}
              />
              <Field
                name="upiName"
                label="Name shown on UPI"
                required={false}
                value={data.settings.upiName}
              />
              <Field
                name="threshold"
                label="Ask extra confirmation for udhaar above (₹)"
                type="number"
                step="0.01"
                value={decimalAmount(data.settings.creditConfirmationThresholdPaise)}
              />
              <details className="more-options">
                <summary>Local weights (optional)</summary>
                <div className="form-grid">
                  <Field
                    name="pav"
                    label="1 pav weight in grams (e.g. 250)"
                    type="number"
                    min="1"
                    step="1"
                    required={false}
                    value={data.settings.pavGrams}
                  />
                </div>
              </details>
              <button className="primary" disabled={offline || busy}>
                Save settings
              </button>
            </form>
          </Panel>

          <Panel title="Staff access">
            <p>Invite a helper or family member to use the counter on their phone.</p>
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
              <button disabled={offline || busy}>Create invite link</button>
            </form>
            {invite && (
              <div className="inline-drawer stacked">
                <p>Share this link privately. It expires in 2 days.</p>
                <input
                  aria-label="Invitation link"
                  value={invite}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(invite);
                    notify('Invite link copied.');
                  }}
                >
                  Copy link
                </button>
              </div>
            )}
          </Panel>
        </div>
      )}

      <Modal
        open={Boolean(editingItem)}
        title={selectedProduct ? `Edit · ${selectedProduct.name}` : 'Add new item'}
        onClose={() => setEditingItem(null)}
      >
        {editingItem && (
          <form
            className="form-grid"
            key={(selectedProduct?.id ?? 'new') + (selectedProduct?.version ?? '')}
            onSubmit={(e) => {
              const f = fields(e);
              void run(async () => {
                const displayUnit = sellBy === 'gram' ? 'kg' : 'pcs';
                const priceQty = sellBy === 'gram' ? 1000 : 1;
                const body = {
                  name: str(f, 'name'),
                  variant: str(f, 'variant'),
                  sku: str(f, 'sku') || null,
                  baseUnit: sellBy,
                  priceQuantity: priceQty,
                  pricePaise: paise(str(f, 'price')),
                  safetyStock: toBaseUnits(Number(str(f, 'safetyStock') || '0'), displayUnit),
                  supplierId: str(f, 'supplierId') || null,
                  aliases: aliasList(f),
                };
                await api(
                  `${base}/products${selectedProduct ? `/${selectedProduct.id}` : ''}`,
                  selectedProduct ? 'PATCH' : 'POST',
                  {
                    ...body,
                    ...(selectedProduct
                      ? { expectedVersion: selectedProduct.version, archived: f.has('archived') }
                      : {
                          openingStock: toBaseUnits(
                            Number(str(f, 'openingStock') || '0'),
                            displayUnit,
                          ),
                        }),
                  },
                );
                setEditingItem(null);
                await refresh();
                notify('Item saved.');
              });
            }}
          >
            <Field name="name" label="Item name (e.g. Toor dal)" value={selectedProduct?.name} />
            <Field
              name="variant"
              label="Pack size or type (optional, e.g. 100 g)"
              value={selectedProduct?.variant}
              required={false}
            />
            <div>
              <span className="field-label">How do you sell it?</span>
              <div className="quick-chips">
                <button
                  type="button"
                  className={sellBy === 'gram' ? 'primary' : ''}
                  onClick={() => setSellBy('gram')}
                >
                  By weight (kg / g)
                </button>
                <button
                  type="button"
                  className={sellBy === 'each' ? 'primary' : ''}
                  onClick={() => setSellBy('each')}
                >
                  By packet / piece
                </button>
              </div>
            </div>
            <Field
              name="price"
              label={sellBy === 'gram' ? 'Price (₹ per kg)' : 'Price (₹ per packet / piece)'}
              type="number"
              step="0.01"
              value={
                selectedProduct
                  ? decimalAmount(
                      selectedProduct.baseUnit === 'gram' && selectedProduct.priceQuantity !== 1000
                        ? Math.round(
                            (selectedProduct.pricePaise * 1000) / selectedProduct.priceQuantity,
                          )
                        : selectedProduct.pricePaise,
                    )
                  : undefined
              }
            />
            <Field
              name="safetyStock"
              label={`Remind me when stock is below (${unitLabel})`}
              type="number"
              min="0"
              step="any"
              value={
                selectedProduct
                  ? fromBaseUnits(
                      selectedProduct.safetyStock,
                      selectedProduct.baseUnit,
                      selectedProduct.baseUnit === 'gram',
                    )
                  : '0'
              }
            />
            {!selectedProduct && (
              <Field
                name="openingStock"
                label={`Current stock on hand (${unitLabel})`}
                type="number"
                min="0"
                step="any"
                value="0"
              />
            )}
            <details className="more-options">
              <summary>More options (wholesaler, voice names, barcode)</summary>
              <div className="form-grid">
                <Select name="supplierId" label="Wholesaler" value={selectedProduct?.supplierId}>
                  <option value="">Any wholesaler</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Field
                  name="aliases"
                  label="Other names customers say (comma separated)"
                  value={selectedProduct?.aliases.join(', ')}
                  required={false}
                />
                <Field
                  name="sku"
                  label="Barcode / item code (optional)"
                  value={selectedProduct?.sku}
                  required={false}
                />
                {selectedProduct && (
                  <label className="check">
                    <input name="archived" type="checkbox" />
                    Hide this item from the counter
                  </label>
                )}
              </div>
            </details>
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={() => setEditingItem(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || offline}>
                {selectedProduct ? 'Save changes' : 'Add item'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(editingSupplier)}
        title={
          editingSupplier && editingSupplier !== 'new'
            ? `Edit · ${editingSupplier.name}`
            : 'Add wholesaler'
        }
        onClose={() => setEditingSupplier(null)}
      >
        {editingSupplier && (
          <form
            className="form-grid"
            key={editingSupplier === 'new' ? 'new-sup' : editingSupplier.id}
            onSubmit={(e) => {
              const f = fields(e);
              const existing = editingSupplier === 'new' ? null : editingSupplier;
              void run(async () => {
                await api(
                  `${base}/suppliers${existing ? `/${existing.id}` : ''}`,
                  existing ? 'PATCH' : 'POST',
                  {
                    name: str(f, 'name'),
                    phone: str(f, 'phone') || null,
                    archived: f.has('archived'),
                  },
                );
                setEditingSupplier(null);
                await refresh();
                notify('Wholesaler saved.');
              });
            }}
          >
            <Field
              name="name"
              label="Wholesaler name"
              value={editingSupplier === 'new' ? undefined : editingSupplier.name}
            />
            <Field
              name="phone"
              label="Phone (optional)"
              required={false}
              value={editingSupplier === 'new' ? undefined : editingSupplier.phone}
            />
            {editingSupplier !== 'new' && (
              <label className="check">
                <input name="archived" type="checkbox" />
                Remove wholesaler
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={() => setEditingSupplier(null)}>
                Cancel
              </button>
              <button className="primary" disabled={offline || busy}>
                Save wholesaler
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(editingCustomer)}
        title={
          editingCustomer && editingCustomer !== 'new'
            ? `Edit · ${editingCustomer.name}`
            : 'Add customer'
        }
        onClose={() => setEditingCustomer(null)}
      >
        {editingCustomer && (
          <form
            className="form-grid"
            key={editingCustomer === 'new' ? 'new-cust' : editingCustomer.id}
            onSubmit={(e) => {
              const f = fields(e);
              const existing = editingCustomer === 'new' ? null : editingCustomer;
              void run(async () => {
                await api(
                  `${base}/customers${existing ? `/${existing.id}` : ''}`,
                  existing ? 'PATCH' : 'POST',
                  {
                    name: str(f, 'name'),
                    phone: str(f, 'phone') || null,
                    aliases: aliasList(f),
                    archived: f.has('archived'),
                  },
                );
                setEditingCustomer(null);
                await refresh();
                notify('Customer saved.');
              });
            }}
          >
            <Field
              name="name"
              label="Customer name"
              value={editingCustomer === 'new' ? undefined : editingCustomer.name}
            />
            <Field
              name="phone"
              label="Phone (optional)"
              required={false}
              value={editingCustomer === 'new' ? undefined : editingCustomer.phone}
            />
            <details className="more-options">
              <summary>More options (nicknames, remove)</summary>
              <div className="form-grid">
                <Field
                  name="aliases"
                  label="Other names / nicknames (comma separated)"
                  value={editingCustomer === 'new' ? undefined : editingCustomer.aliases.join(', ')}
                  required={false}
                />
                {editingCustomer !== 'new' && (
                  <label className="check">
                    <input name="archived" type="checkbox" />
                    Remove after balance is settled
                  </label>
                )}
              </div>
            </details>
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={() => setEditingCustomer(null)}>
                Cancel
              </button>
              <button className="primary" disabled={offline || busy}>
                Save customer
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function SalesHistory(p: ViewProps) {
  const [sales, setSales] = useState<Page<Sale> | null>(null),
    [sale, setSale] = useState<Sale | null>(null),
    [link, setLink] = useState<BillQrLink | null>(null);
  const { run, base, offline, busy } = p;

  useEffect(() => {
    if (offline) return;
    let active = true;
    void api<Page<Sale>>(`${base}/sales`)
      .then((res) => {
        if (active) setSales(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [base, offline]);

  return (
    <div className="two-columns">
      <Panel
        title="Past bills"
        aside={
          <button
            type="button"
            disabled={offline || busy}
            onClick={() => void run(async () => setSales(await api(`${base}/sales`)))}
          >
            Refresh
          </button>
        }
      >
        {!sales?.items.length ? (
          <div className="empty compact">
            <h3>No bills yet</h3>
            <p>Completed sales from the counter will appear here.</p>
          </div>
        ) : (
          <div className="inner-scroll">
            {sales.items.map((s) => (
              <button
                className={`customer-row ${sale?.id === s.id ? 'selected' : ''}`}
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
                  {new Date(s.createdAt).toLocaleString('en-IN', {
                    timeZone: p.data.settings.timezone,
                  })}
                </span>
                <strong>{inr(s.totalPaise)}</strong>
                <span>{s.paymentMethod.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}
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
            Show older bills
          </button>
        )}
      </Panel>

      <Panel title={sale ? `Bill · ${inr(sale.totalPaise)}` : 'Bill details'}>
        {!sale ? (
          <div className="empty compact">
            <h3>Select a bill</h3>
            <p>Tap any bill to see items or share a QR receipt.</p>
          </div>
        ) : (
          <div className="qr-panel">
            {sale.items?.map((i) => (
              <p key={i.productId}>
                {i.name} {i.variant} · {formatStockQty(i.quantity, i.baseUnit)} ·{' '}
                {inr(i.lineTotalPaise)}
              </p>
            ))}
            <button
              className="primary"
              disabled={offline || busy}
              onClick={() => void run(async () => setLink(await requestSaleBillQr(base, sale.id)))}
            >
              Share receipt QR
            </button>
            {link && (
              <>
                <img
                  className="qr"
                  src={link.qrDataUrl}
                  alt="Open this sale receipt"
                  width="280"
                  height="280"
                />
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
                  Cancel this link
                </button>
              </>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
