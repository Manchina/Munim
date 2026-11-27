import { Panel, type ViewProps } from '../../app/App';
import { durableWrite } from '../../lib/mutations';
import { fields, str, num, Field, Select } from '../../components/Forms';
export function Stock(p: ViewProps) {
  const { data, offline, busy, run, refresh, base, notify } = p;
  const scope = `${p.userId}:${data.settings.id}`;
  return (
    <div className="two-columns">
      <Panel
        title="Stock on hand"
        aside={<span className="pill">{data.products.length} products</span>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Available</th>
                <th>Safety level</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    <small>{product.variant}</small>
                  </td>
                  <td>
                    {product.quantity} {product.baseUnit === 'gram' ? 'g' : 'each'}
                    {product.quantity <= product.safetyStock && (
                      <span className="badge">Low stock</span>
                    )}
                  </td>
                  <td>{product.safetyStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Receive stock</h3>
        <form
          className="form-grid"
          onSubmit={(e) => {
            const f = fields(e);
            void run(async () => {
              await durableWrite(scope, `${base}/inventory/receipts`, {
                items: [{ productId: str(f, 'productId'), quantity: num(f, 'quantity') }],
              });
              notify('Stock received.');
              await refresh();
            });
          }}
        >
          <Select name="productId" label="Product">
            {data.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.variant} ({product.baseUnit})
              </option>
            ))}
          </Select>
          <Field
            name="quantity"
            label="Quantity in grams or counts"
            type="number"
            min="1"
            step="1"
          />
          <button disabled={offline || busy || !data.products.length}>Record received stock</button>
        </form>
      </Panel>
      <Panel
        title="Wholesale restock list"
        aside={<span className="pill">{data.restock.length} requests</span>}
      >
        {[
          ...data.suppliers.map((s) => ({ id: s.id, name: s.name })),
          { id: null, name: 'Unassigned supplier' },
        ].map((s) => {
          const items = data.restock.filter(
            (r) =>
              r.supplierId === s.id ||
              (s.id === null && !data.suppliers.some((x) => x.id === r.supplierId)),
          );
          return items.length ? (
            <div key={s.id ?? 'none'}>
              <p className="eyebrow">{s.name}</p>
              {items.map((r) => (
                <div className="restock-item" key={r.id}>
                  <strong>
                    {r.name} {r.variant}
                  </strong>
                  <span className="badge">Asked {r.requestCount}×</span>
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      const f = fields(e);
                      void run(async () => {
                        await durableWrite(scope, `${base}/restock-requests/${r.id}/procure`, {
                          quantityReceived: r.productId ? num(f, 'quantity') : 0,
                        });
                        notify('Request marked procured.');
                        await refresh();
                      });
                    }}
                  >
                    {r.productId && (
                      <label>
                        Received (base units)
                        <input
                          name="quantity"
                          aria-label={`Quantity received for ${r.name}`}
                          type="number"
                          min="0"
                          step="1"
                          defaultValue="0"
                          required
                        />
                      </label>
                    )}
                    <button disabled={offline || busy}>Mark procured</button>
                  </form>
                  {!r.productId && (
                    <small>Add this variant to the catalog before receiving its stock.</small>
                  )}
                </div>
              ))}
            </div>
          ) : null;
        })}
        {!data.restock.length && (
          <div className="empty compact">
            <h3>Nothing forgotten.</h3>
            <p>Capture requests here for your next wholesale trip.</p>
          </div>
        )}
        <h3>Add a request</h3>
        <form
          className="form-grid"
          onSubmit={(e) => {
            const f = fields(e);
            void run(async () => {
              const productId = str(f, 'productId') || null;
              const product = data.products.find((p) => p.id === productId);
              await durableWrite(scope, `${base}/restock-requests`, {
                productId,
                name: product?.name ?? str(f, 'name'),
                variant: product?.variant ?? str(f, 'variant'),
                supplierId: str(f, 'supplierId') || null,
              });
              await refresh();
              notify('Restock demand recorded.');
            });
          }}
        >
          <Select name="productId" label="Catalog product (optional)">
            <option value="">Unstocked product</option>
            {data.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.variant}
              </option>
            ))}
          </Select>
          <Field name="name" label="Requested product name" required={false} />
          <Field name="variant" label="Variant / size" required={false} />
          <Select name="supplierId" label="Supplier">
            <option value="">Unassigned</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <button disabled={offline || busy}>Add request</button>
        </form>
      </Panel>
    </div>
  );
}
