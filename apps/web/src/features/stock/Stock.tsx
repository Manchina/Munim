import { useState } from 'react';
import type { Product, Restock } from '@munim/contracts';
import { Panel, type ViewProps } from '../../app/App';
import { durableWrite } from '../../lib/mutations';
import { fields, str, Field, Select } from '../../components/Forms';
import { Modal } from '../../components/Modal';
import { formatStockQty, toBaseUnits, type DisplayUnit } from '../../lib/units';

type RowAction = { product: Product; mode: 'add' | 'adjust' } | null;

export function Stock(p: ViewProps) {
  const { data, offline, busy, run, refresh, base, notify } = p;
  const scope = `${p.userId}:${data.settings.id}`;
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [action, setAction] = useState<RowAction>(null);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<DisplayUnit>('kg');
  const [reason, setReason] = useState('Spoiled or damaged');
  const [buying, setBuying] = useState<{ restock: Restock; product: Product } | null>(null);
  const [buyAmount, setBuyAmount] = useState('');
  const [buyUnit, setBuyUnit] = useState<DisplayUnit>('kg');
  const [addingRestock, setAddingRestock] = useState(false);

  const q = query.trim().toLowerCase();
  const visibleProducts = data.products.filter((product) => {
    if (lowOnly && product.quantity > product.safetyStock) return false;
    if (!q) return true;
    return `${product.name} ${product.variant}`.toLowerCase().includes(q);
  });

  function openRowAction(product: Product, mode: 'add' | 'adjust') {
    setAction({ product, mode });
    setAmount('');
    setUnit(product.baseUnit === 'gram' ? 'kg' : 'pcs');
    setReason('Spoiled or damaged');
  }

  return (
    <>
      <div className="two-columns">
        <Panel
          title="Stock on hand"
          aside={<span className="pill">{data.products.length} items</span>}
        >
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search items…"
              aria-label="Search stock items"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className={lowOnly ? 'primary' : ''}
              onClick={() => setLowOnly((v) => !v)}
            >
              Low stock only
            </button>
          </div>

          <div className="stock-list">
            {visibleProducts.map((product) => {
              const isLow = product.quantity <= product.safetyStock;
              return (
                <div className="stock-row" key={product.id}>
                  <div className="stock-row-main">
                    <div>
                      <strong>{product.name}</strong>
                      {product.variant && <small>{product.variant}</small>}
                      <small>
                        Alert below {formatStockQty(product.safetyStock, product.baseUnit)}
                      </small>
                    </div>
                    <div className="stock-row-right">
                      <span className="stock-qty">
                        {formatStockQty(product.quantity, product.baseUnit)}
                      </span>
                      {isLow && <span className="badge">Low</span>}
                    </div>
                    <div className="stock-row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Add stock for ${product.name}`}
                        title="Add stock"
                        disabled={offline || busy}
                        onClick={() => openRowAction(product, 'add')}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="quiet icon-btn"
                        aria-label={`Remove or adjust stock for ${product.name}`}
                        title="Remove / adjust stock"
                        disabled={offline || busy}
                        onClick={() => openRowAction(product, 'adjust')}
                      >
                        −
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!visibleProducts.length && (
              <div className="empty compact">
                <h3>No matching items</h3>
                <p>
                  {lowOnly ? 'All items are above their low-stock alert.' : 'Try another search.'}
                </p>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="Shopping / restock list"
          aside={
            <div className="stock-row-right">
              <span className="pill">{data.restock.length} needed</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Add to shopping list"
                title="Add to shopping list"
                disabled={offline || busy}
                onClick={() => setAddingRestock(true)}
              >
                +
              </button>
            </div>
          }
        >
          <div className="inner-scroll">
            {[
              ...data.suppliers.map((s) => ({ id: s.id, name: s.name })),
              { id: null, name: 'Any wholesaler' },
            ].map((s) => {
              const items = data.restock.filter(
                (r) =>
                  r.supplierId === s.id ||
                  (s.id === null && !data.suppliers.some((x) => x.id === r.supplierId)),
              );
              return items.length ? (
                <div key={s.id ?? 'none'} className="restock-group">
                  <p className="eyebrow">{s.name}</p>
                  {items.map((r) => {
                    const product = data.products.find((x) => x.id === r.productId);
                    return (
                      <div className="restock-item" key={r.id}>
                        <div className="restock-header">
                          <div>
                            <strong>
                              {r.name} {r.variant}
                            </strong>
                            <span className="badge">Asked {r.requestCount}×</span>
                          </div>
                          {r.productId && product ? (
                            <button
                              type="button"
                              disabled={offline || busy}
                              onClick={() => {
                                setBuying({ restock: r, product });
                                setBuyAmount('');
                                setBuyUnit(product.baseUnit === 'gram' ? 'kg' : 'pcs');
                              }}
                            >
                              Bought
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={offline || busy}
                              onClick={() =>
                                void run(async () => {
                                  await durableWrite(
                                    scope,
                                    `${base}/restock-requests/${r.id}/procure`,
                                    { quantityReceived: 0 },
                                  );
                                  notify('Removed from shopping list.');
                                  await refresh();
                                })
                              }
                            >
                              Tick off
                            </button>
                          )}
                        </div>
                        {!r.productId && (
                          <small>
                            Unlisted item — add it in Manage Store → Items to track its stock.
                          </small>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null;
            })}
            {!data.restock.length && (
              <div className="empty compact">
                <h3>Nothing on your list</h3>
                <p>Tap + above to add items you need to buy.</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Modal
        open={Boolean(action)}
        title={
          action
            ? `${action.mode === 'add' ? 'Add stock' : 'Adjust stock'} · ${action.product.name}`
            : ''
        }
        onClose={() => setAction(null)}
      >
        {action && (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const qty = toBaseUnits(Number(amount), unit);
                if (qty < 1) throw new Error('Enter a quantity greater than 0.');
                if (action.mode === 'add') {
                  await durableWrite(scope, `${base}/inventory/receipts`, {
                    items: [{ productId: action.product.id, quantity: qty }],
                  });
                  notify(
                    `Added ${formatStockQty(qty, action.product.baseUnit)} to ${action.product.name}.`,
                  );
                } else {
                  const isIncrease = reason === 'Found extra stock';
                  await durableWrite(scope, `${base}/inventory/adjustments`, {
                    productId: action.product.id,
                    delta: isIncrease ? qty : -qty,
                    reason,
                  });
                  notify(`Updated stock for ${action.product.name}.`);
                }
                setAction(null);
                await refresh();
              });
            }}
          >
            <p>
              Current stock: <strong>{formatStockQty(action.product.quantity, action.product.baseUnit)}</strong>
            </p>
            <label>
              {action.mode === 'add' ? 'Quantity added' : 'Quantity to adjust'}
              <input
                type="number"
                min="0.001"
                step="any"
                required
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {action.product.baseUnit === 'gram' && (
              <label>
                Unit
                <select value={unit} onChange={(e) => setUnit(e.target.value as DisplayUnit)}>
                  <option value="kg">kg</option>
                  <option value="g">grams</option>
                </select>
              </label>
            )}
            {action.mode === 'adjust' && (
              <label>
                Reason
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="Spoiled or damaged">Spoiled / damaged (−)</option>
                  <option value="Recount difference">Recount / missing (−)</option>
                  <option value="Found extra stock">Found extra (+)</option>
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={() => setAction(null)}>
                Cancel
              </button>
              <button className="primary" disabled={offline || busy}>
                Save
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(buying)}
        title={buying ? `Bought · ${buying.restock.name}` : ''}
        onClose={() => setBuying(null)}
      >
        {buying && (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const qty = buyAmount.trim() ? toBaseUnits(Number(buyAmount), buyUnit) : 0;
                await durableWrite(scope, `${base}/restock-requests/${buying.restock.id}/procure`, {
                  quantityReceived: qty,
                });
                setBuying(null);
                notify('Marked bought and stock updated.');
                await refresh();
              });
            }}
          >
            <label>
              Quantity bought (optional)
              <input
                type="number"
                min="0"
                step="any"
                autoFocus
                placeholder="Leave blank if just ticking off"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
              />
            </label>
            {buying.product.baseUnit === 'gram' && (
              <label>
                Unit
                <select value={buyUnit} onChange={(e) => setBuyUnit(e.target.value as DisplayUnit)}>
                  <option value="kg">kg</option>
                  <option value="g">grams</option>
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={() => setBuying(null)}>
                Cancel
              </button>
              <button className="primary" disabled={offline || busy}>
                Confirm bought
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={addingRestock}
        title="Add to shopping list"
        onClose={() => setAddingRestock(false)}
      >
        <form
          className="form-grid"
          onSubmit={(e) => {
            const f = fields(e);
            void run(async () => {
              const productId = str(f, 'productId') || null;
              const product = data.products.find((prod) => prod.id === productId);
              await durableWrite(scope, `${base}/restock-requests`, {
                productId,
                name: product?.name ?? str(f, 'name'),
                variant: product?.variant ?? str(f, 'variant'),
                supplierId: str(f, 'supplierId') || null,
              });
              setAddingRestock(false);
              await refresh();
              notify('Added to shopping list.');
            });
          }}
        >
          <Select name="productId" label="Existing item (optional)">
            <option value="">New / unlisted item</option>
            {data.products.map((prod) => (
              <option key={prod.id} value={prod.id}>
                {prod.name} {prod.variant}
              </option>
            ))}
          </Select>
          <Field name="name" label="Item name (if new)" required={false} />
          <Field name="variant" label="Pack size / brand (optional)" required={false} />
          <Select name="supplierId" label="Wholesaler (optional)">
            <option value="">Any wholesaler</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <div className="modal-actions">
            <button type="button" className="quiet" onClick={() => setAddingRestock(false)}>
              Cancel
            </button>
            <button className="primary" disabled={offline || busy}>
              Add to list
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
