import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { lineTotal, sumMoney, type CartInput, type Preview, type Sale } from '@munim/contracts';
import { parseCommand } from '@munim/command-parser';
import { ApiError, api, inr, decimalAmount } from '../../lib/api';
import { Panel, type ViewProps } from '../../app/App';
import { QR } from '../receipts/Receipt';
import { useVoice } from '../../voice/useVoice';
import { durableWrite } from '../../lib/mutations';
type Draft = CartInput & { attempt?: { quote: string; key: string } };
const blank: Draft = { items: [], paymentMethod: 'cash', customerId: null };
export function Counter({ data, base, userId, offline, busy, run, refresh, notify }: ViewProps) {
  const draftKey = `draft:${userId}:${data.settings.id}`;
  const [draft, setDraft] = useState<Draft>(blank),
    [ready, setReady] = useState(false),
    [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [share, setShare] = useState(false),
    [lastSale, setLastSale] = useState<Sale | null>(null),
    [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const history = useRef<Draft[]>([]),
    seenAlerts = useRef(new Set<string>());
  const voice = useVoice(setText, notify);
  const disabled = !ready || busy || Boolean(draft.attempt);
  useEffect(() => {
    let active = true;
    void get<Draft>(draftKey)
      .then((value) => {
        if (active) {
          setDraft(value ?? blank);
          setReady(true);
        }
      })
      .catch(() => notify('Draft storage is unavailable. Enable local storage before checkout.'));
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (offline) {
      setPreview(null);
      voice.stop();
    }
  }, [offline]);
  async function update(next: Draft, remember = true) {
    if (draft.attempt) throw new Error('Resolve the pending checkout before changing this cart.');
    if (
      next.items.length > 100 ||
      next.items.some(
        (i) => !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 2_000_000_000,
      )
    )
      throw new Error('Use up to 100 products with valid whole quantities.');
    sumMoney(
      next.items.map((i) => {
        const p = data.products.find((p) => p.id === i.productId);
        return p ? lineTotal(p.pricePaise, i.quantity, p.priceQuantity) : 0;
      }),
    );
    await set(draftKey, next);
    if (remember) history.current.push(draft);
    setDraft(next);
    setPreview(null);
    setConfirmed(false);
    setShare(false);
  }
  async function review(next: Draft = draft, showQr = false) {
    voice.stop();
    if (!next.items.length) throw new Error('Add an item first.');
    if (offline) throw new Error('Reconnect to validate this cart.');
    const { attempt: _, ...cart } = next;
    const value = await api<Preview>(`${base}/sales/preview`, 'POST', cart);
    setPreview(value);
    setConfirmed(false);
    setShare(showQr);
  }
  async function command(value: string) {
    if (disabled) return;
    voice.stop();
    const intent = parseCommand(value, {
      products: data.products,
      customers: data.customers,
      pavGrams: data.settings.pavGrams,
    });
    if (intent.type === 'unsupported' || intent.type === 'ambiguous') {
      notify(
        `${intent.message}${intent.type === 'ambiguous' ? ` ${intent.candidates.join(' / ')}` : ''}`,
      );
      return;
    }
    if (intent.type === 'add') {
      const counts = new Map(draft.items.map((i) => [i.productId, i.quantity]));
      for (const i of intent.items)
        counts.set(i.productId, (counts.get(i.productId) ?? 0) + i.quantity);
      await update({
        ...draft,
        items: [...counts].map(([productId, quantity]) => ({ productId, quantity })),
      });
      notify('Items added. Check your cart before checkout.');
    }
    if (intent.type === 'remove')
      await update({
        ...draft,
        items: draft.items.filter((i) => i.productId !== intent.productId),
      });
    if (intent.type === 'undo') {
      const previous = history.current.pop();
      if (previous) await update(previous, false);
      else notify('There is nothing to undo.');
    }
    if (intent.type === 'checkout' || intent.type === 'credit') {
      const next: Draft = {
        ...draft,
        paymentMethod: intent.type === 'credit' ? 'credit' : intent.method,
        customerId: intent.type === 'credit' ? intent.customerId : null,
      };
      await update(next);
      await review(next);
    }
    if (intent.type === 'restock') {
      if (offline) throw new Error('Reconnect to record a restock request.');
      const { type: _, ...body } = intent;
      await durableWrite(`${userId}:${data.settings.id}`, `${base}/restock-requests`, body);
      notify('Added to your wholesale list.');
      await refresh();
    }
  }
  async function commit() {
    voice.stop();
    if (offline) throw new Error('Reconnect before checkout.');
    if (!draft.attempt && (!preview || !confirmed))
      throw new Error('Review and confirm the payment or credit first.');
    const attempt = draft.attempt ?? { quote: preview!.quote, key: crypto.randomUUID() };
    await set(draftKey, { ...draft, attempt });
    setDraft({ ...draft, attempt });
    let sale: Sale;
    try {
      sale = await api<Sale>(
        `${base}/sales`,
        'POST',
        { quote: attempt.quote, confirmed: true },
        attempt.key,
      );
    } catch (e) {
      if (
        e instanceof ApiError &&
        [400, 409, 422].includes(e.status) &&
        e.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        const { attempt: _, ...next } = draft;
        await set(draftKey, next);
        setDraft(next);
        setPreview(null);
        setConfirmed(false);
      }
      throw e;
    }
    // Only a definitive checkout rejection may unlock the original draft. A later
    // catalog refresh failure must never restore a cart whose sale already committed.
    await set(draftKey, blank);
    setDraft(blank);
    setPreview(null);
    setConfirmed(false);
    history.current = [];
    setLastSale(sale);
    setLink(null);
    setShare(false);
    notify(
      `Sale recorded · ${inr(sale.totalPaise)}${sale.lowStock?.length ? ` · Low stock: ${sale.lowStock.join(', ')}` : ''}`,
    );
    if (!seenAlerts.current.has(sale.id)) {
      seenAlerts.current.add(sale.id);
      voice.warn(sale.lowStock ?? []);
    }
    await refresh().catch(() =>
      notify('Sale recorded. Refresh the store when the connection returns.'),
    );
  }
  let total: number | null = null;
  try {
    total = sumMoney(
      draft.items.map((i) => {
        const p = data.products.find((p) => p.id === i.productId);
        return p ? lineTotal(p.pricePaise, i.quantity, p.priceQuantity) : 0;
      }),
    );
  } catch {
    /* A newer catalog may make an old draft exceed the monetary limit. */
  }
  const low = data.products.filter((p) => p.quantity <= p.safetyStock);
  const upi =
    preview && data.settings.upiPayee && draft.paymentMethod === 'upi'
      ? `upi://pay?${new URLSearchParams({ pa: data.settings.upiPayee, pn: data.settings.upiName ?? data.settings.name, am: decimalAmount(preview.totalPaise), cu: 'INR' })}`
      : null;
  return (
    <>
      <div className="counter-grid">
        <div>
          <Panel title="Live cart" aside={<span className="pill">{draft.items.length} items</span>}>
            {!draft.items.length ? (
              <div className="empty">
                <div className="basket">▥</div>
                <h3>Ready when you are.</h3>
                <p>Speak an order, type it below, or tap a product.</p>
                <div className="samples">
                  {['1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet', 'aadha kilo rice'].map(
                    (s) => (
                      <button
                        disabled={disabled}
                        key={s}
                        onClick={() => void run(() => command(s))}
                      >
                        {s} ↗
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="cart-lines">
                {draft.items.map((i, n) => {
                  const p = data.products.find((p) => p.id === i.productId);
                  return (
                    <div className="cart-line" key={i.productId}>
                      <span className="line-number">{String(n + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{p?.name ?? 'Unavailable product'}</strong>
                        <small>
                          {p?.variant} ·{' '}
                          {p
                            ? `${inr(p.pricePaise)} / ${p.priceQuantity} ${p.baseUnit === 'gram' ? 'g' : 'each'}`
                            : 'Refresh required'}
                        </small>
                      </div>
                      <label className="quantity-label">
                        <span className="sr-only">Quantity for {p?.name}</span>
                        <input
                          type="number"
                          min="1"
                          max="2000000000"
                          step="1"
                          disabled={disabled}
                          value={i.quantity}
                          onChange={(e) => {
                            const quantity = Number(e.target.value);
                            if (Number.isSafeInteger(quantity) && quantity > 0)
                              void run(() =>
                                update({
                                  ...draft,
                                  items: draft.items.map((x) =>
                                    x.productId === i.productId ? { ...x, quantity } : x,
                                  ),
                                }),
                              );
                          }}
                        />
                        <small>{p?.baseUnit === 'gram' ? 'grams' : 'count'}</small>
                      </label>
                      <strong>
                        {p && total !== null
                          ? inr(lineTotal(p.pricePaise, i.quantity, p.priceQuantity))
                          : '—'}
                      </strong>
                      <button
                        disabled={disabled}
                        className="quiet"
                        aria-label={`Remove ${p?.name}`}
                        onClick={() =>
                          void run(() =>
                            update({
                              ...draft,
                              items: draft.items.filter((x) => x.productId !== i.productId),
                            }),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="cart-total">
              <span>
                Cart total
                <small>
                  {preview ? 'Validated by your store' : 'Final prices checked at checkout'}
                </small>
              </span>
              <strong>
                {total === null ? 'Review quantities' : inr(preview?.totalPaise ?? total)}
              </strong>
            </div>
            <div className="payment-fields">
              <label>
                Payment
                <select
                  value={draft.paymentMethod}
                  disabled={disabled}
                  onChange={(e) =>
                    void run(() =>
                      update({
                        ...draft,
                        paymentMethod: e.target.value as Draft['paymentMethod'],
                        customerId: e.target.value === 'credit' ? draft.customerId : null,
                      }),
                    )
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="credit">Udhaar / credit</option>
                </select>
              </label>
              {draft.paymentMethod === 'credit' && (
                <label>
                  Customer
                  <select
                    value={draft.customerId ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      void run(() => update({ ...draft, customerId: e.target.value || null }))
                    }
                  >
                    <option value="">Choose customer</option>
                    {data.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {draft.attempt ? (
              <div className="notice">
                <p>Checkout result is pending. Your cart is locked to prevent a duplicate sale.</p>
                <button
                  className="primary"
                  disabled={busy || offline}
                  onClick={() => void run(commit)}
                >
                  Check / retry checkout
                </button>
              </div>
            ) : preview ? (
              <div className="confirmation">
                <h3>
                  {preview.requiresCreditConfirmation
                    ? 'High-value credit · confirm carefully'
                    : 'Confirm checkout'}
                </h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {draft.paymentMethod === 'credit'
                    ? `Record ${inr(preview.totalPaise)} as credit for ${data.customers.find((c) => c.id === draft.customerId)?.name}?`
                    : `I confirm ${inr(preview.totalPaise)} was received by ${draft.paymentMethod.toUpperCase()}.`}
                </label>
                <button
                  className="primary"
                  disabled={!confirmed || busy || offline}
                  onClick={() => void run(commit)}
                >
                  Record sale · {inr(preview.totalPaise)}
                </button>
              </div>
            ) : (
              <button
                className="primary full"
                disabled={disabled || offline || !draft.items.length}
                onClick={() => void run(() => review())}
              >
                Review checkout <span>→</span>
              </button>
            )}
            <div className="cart-actions">
              <button
                disabled={disabled || !history.current.length}
                onClick={() => void run(() => command('undo'))}
              >
                ↶ Undo
              </button>
              <button
                disabled={disabled || !draft.items.length || offline}
                onClick={() => void run(() => review(draft, true))}
              >
                Share QR Bill
              </button>
              <button
                disabled={disabled || !draft.items.length}
                onClick={() => void run(() => update(blank))}
              >
                Clear cart
              </button>
            </div>
            {share && preview && (
              <div className="qr-panel">
                <h3>Unpaid cart preview · {inr(preview.totalPaise)}</h3>
                {preview.items.map((i) => (
                  <p key={i.productId}>
                    {i.name} · {i.quantity} {i.baseUnit} · {inr(i.lineTotalPaise)}
                  </p>
                ))}
                {upi ? (
                  <>
                    <QR value={upi} label="Pay this cart with UPI" />
                    <p>Scan to pay. Confirm receipt of payment before checkout.</p>
                  </>
                ) : (
                  <p>
                    {draft.paymentMethod === 'upi'
                      ? 'Configure a UPI payee in Manage Store.'
                      : 'Choose UPI to show a payment QR. Receipt links are available after checkout.'}
                  </p>
                )}
              </div>
            )}
            {lastSale && (
              <div className="recent">
                <div>
                  <span className="eyebrow">LAST COMPLETED SALE</span>
                  <h3>
                    {inr(lastSale.totalPaise)} · {lastSale.paymentMethod.toUpperCase()}
                  </h3>
                </div>
                <button
                  disabled={busy || offline}
                  onClick={() =>
                    void run(async () => {
                      setLink(await api(`${base}/sales/${lastSale.id}/receipt-links`, 'POST'));
                    })
                  }
                >
                  Share receipt QR
                </button>
                {link && (
                  <div className="qr-panel">
                    <QR value={link.url} label="Open this sale receipt" />
                    <a href={link.url} target="_blank" rel="noreferrer">
                      Open receipt
                    </a>
                    <p>Expires in 7 days. Contains only this sale.</p>
                    <button
                      disabled={busy || offline}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `${base}/sales/${lastSale.id}/receipt-links/${link.id}`,
                            'DELETE',
                          );
                          setLink(null);
                        })
                      }
                    >
                      Revoke link
                    </button>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
        <aside>
          <Panel title="Quick add">
            <div className="product-grid">
              {data.products.map((p) => (
                <button
                  disabled={disabled}
                  key={p.id}
                  onClick={() =>
                    void run(async () => {
                      const found = draft.items.find((i) => i.productId === p.id);
                      await update({
                        ...draft,
                        items: found
                          ? draft.items.map((i) =>
                              i.productId === p.id
                                ? { ...i, quantity: i.quantity + p.priceQuantity }
                                : i,
                            )
                          : [...draft.items, { productId: p.id, quantity: p.priceQuantity }],
                      });
                    })
                  }
                >
                  <span>{p.name}</span>
                  <small>{p.variant || `${p.priceQuantity} g`}</small>
                  <strong>{inr(p.pricePaise)}</strong>
                  {p.quantity <= p.safetyStock && (
                    <span className="low-dot" aria-label="Low stock">
                      ●
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Panel>
          <div className="stock-note">
            <span>↘</span>
            <div>
              <strong>
                {low.length ? `${low.length} products running low` : 'Stock is looking healthy'}
              </strong>
              <p>
                {low.length
                  ? low.map((p) => p.name).join(', ')
                  : 'We’ll flag items as they reach their safety level.'}
              </p>
            </div>
          </div>
        </aside>
      </div>
      {createPortal(
        <section className="voice-bar" aria-label="Voice and text commands">
          <div className="voice-top">
            <span className={`mic-state ${voice.listening ? 'listening' : ''}`}>
              ● {voice.listening ? 'Listening…' : 'Your voice, at the counter'}
            </span>
            <small>{voice.interim || 'Hinglish & English · Always review before checkout'}</small>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => command(text));
            }}
          >
            <button
              type="button"
              className="mic"
              disabled={disabled || !voice.supported}
              onClick={() => {
                if (voice.listening) voice.stop();
                else {
                  if (!sessionStorage.getItem('speech-consent')) {
                    notify(
                      'Your browser may send speech to its speech service. Tap Start listening again to accept for this session.',
                    );
                    sessionStorage.setItem('speech-consent', '1');
                    return;
                  }
                  voice.start();
                }
              }}
            >
              {voice.listening ? '■ Stop' : '● Start listening'}
            </button>
            <input
              aria-label="Command transcript"
              placeholder="Try: 1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet"
              value={text}
              maxLength={1000}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="primary" disabled={disabled || !text.trim()}>
              Use command →
            </button>
          </form>
          {!voice.supported && (
            <small>Speech is unavailable in this browser. Type a command or use the samples.</small>
          )}
        </section>,
        document.body,
      )}
    </>
  );
}
