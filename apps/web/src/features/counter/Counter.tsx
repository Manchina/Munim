import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import {
  lineTotal,
  sumMoney,
  type CartInput,
  type CommandInterpretation,
  type Preview,
  type Sale,
} from '@munim/contracts';
import { parseCommand } from '@munim/command-parser';
import { ApiError, api, decimalAmount, inr } from '../../lib/api';
import { buildUpiPaymentUri, requestSaleBillQr, type BillQrLink } from '../../lib/qr';
import { Panel, type ViewProps } from '../../app/App';
import { QR } from '../receipts/Receipt';
import { useVoice } from '../../voice/useVoice';
import { useRecordedCommand } from '../../voice/useRecordedCommand';
import { durableWrite } from '../../lib/mutations';
type Draft = CartInput & { attempt?: { quote: string; key: string } };
type SpokenApproval = { quote: string; phrase: string; expiresAt: number; session: AbortSignal };
type CommandSource = { kind: 'local' | 'transcript' } | { kind: 'voice'; session: AbortSignal };
const blank: Draft = { items: [], paymentMethod: 'cash', customerId: null };
const confirmPayment = 'confirm payment received';
const confirmCredit = 'confirm credit';
export function Counter({ data, base, userId, offline, busy, run, refresh, notify }: ViewProps) {
  const draftKey = `draft:${userId}:${data.settings.id}`;
  const [draft, setDraft] = useState<Draft>(blank),
    [ready, setReady] = useState(false),
    [text, setText] = useState('');
  const [agentFallback, setAgentFallback] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [share, setShare] = useState(false),
    [lastSale, setLastSale] = useState<Sale | null>(null),
    [link, setLink] = useState<BillQrLink | null>(null);
  const history = useRef<Draft[]>([]),
    seenAlerts = useRef(new Set<string>());
  const spokenApproval = useRef<SpokenApproval | null>(null);
  const voice = useVoice(spokenCommand, notify);
  const recording = useRecordedCommand(
    (clip, signal) =>
      api<{ transcript: string }>(`${base}/commands/transcribe`, 'POST', clip, undefined, signal),
    setText,
    notify,
  );
  const recordingActive = recording.phase !== 'idle';
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
      .catch(() => notify('Could not save your cart on this device. Check browser storage settings.'));
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (offline) {
      setPreview(null);
      voice.stop();
      recording.discard();
    }
  }, [offline]);
  useEffect(() => {
    if (!voice.active) spokenApproval.current = null;
  }, [voice.active]);
  async function update(next: Draft, remember = true) {
    if (draft.attempt) throw new Error('Finish or retry the pending bill before changing this cart.');
    spokenApproval.current = null;
    if (
      next.items.length > 100 ||
      next.items.some(
        (i) => !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 2_000_000_000,
      )
    )
      throw new Error('Please keep up to 100 items with whole numbers.');
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
    spokenApproval.current = null;
    if (!next.items.length) throw new Error('Add an item first.');
    if (offline) throw new Error('Go online to check prices and complete this bill.');
    const { attempt: _, ...cart } = next;
    const value = await api<Preview>(`${base}/sales/preview`, 'POST', cart);
    setPreview(value);
    setConfirmed(false);
    setShare(showQr);
    return value;
  }
  async function spokenCommand(value: string, session: AbortSignal) {
    if (disabled || offline || session.aborted) return;
    setText(`Munim, ${value}`.slice(0, 1000));
    const phrase = value
      .toLowerCase()
      .replace(/[.!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    await run(async () => {
      try {
        if (phrase === 'cancel') {
          spokenApproval.current = null;
          setPreview(null);
          setConfirmed(false);
          setShare(false);
          await feedback('Checkout cancelled. Your cart is still open.', session);
        } else if (phrase === confirmPayment || phrase === confirmCredit) {
          const approval = spokenApproval.current;
          if (
            !approval ||
            approval.session !== session ||
            approval.phrase !== phrase ||
            approval.quote !== preview?.quote ||
            Date.now() >= approval.expiresAt
          ) {
            await feedback('Please ask for checkout and confirm after I read it back.', session);
            return;
          }
          spokenApproval.current = null;
          await commit(approval.quote, session);
        } else {
          await command(value, { kind: 'voice', session });
        }
      } catch (e) {
        if (!session.aborted)
          await feedback(
            e instanceof Error ? e.message : 'Please try that command again.',
            session,
          );
      }
    });
  }
  async function feedback(message: string, session?: AbortSignal) {
    if (session?.aborted) return;
    notify(message);
    if (session) await voice.speak(message, session);
  }
  async function command(value: string, source: CommandSource = { kind: 'local' }) {
    if (disabled) return;
    const session = source.kind === 'voice' ? source.session : undefined;
    let normalized = value;
    if (source.kind !== 'local' && !offline && value.trim()) {
      try {
        const response = await api<CommandInterpretation>(
          `${base}/commands/interpret`,
          'POST',
          { transcript: value },
          undefined,
          session,
        );
        if (session?.aborted) return;
        setAgentFallback(false);
        if (response.type === 'clarify') {
          await feedback(response.message, session);
          return;
        }
        normalized = response.command;
      } catch (e) {
        if (session?.aborted) return;
        if (!(e instanceof TypeError) && !(e instanceof ApiError && [429, 503].includes(e.status)))
          throw e;
        setAgentFallback(true);
      }
    }
    const intent = parseCommand(normalized, {
      products: data.products,
      customers: data.customers,
      pavGrams: data.settings.pavGrams,
    });
    if (intent.type === 'unsupported' || intent.type === 'ambiguous') {
      await feedback(
        `${intent.message}${intent.type === 'ambiguous' ? ` ${intent.candidates.join(' / ')}` : ''}`,
        session,
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
      const added = intent.items.map(({ productId, quantity }) => {
        const product = data.products.find((p) => p.id === productId);
        return `${quantity}${product?.baseUnit === 'gram' ? ' grams of' : ''} ${product?.name ?? 'item'}`;
      });
      await feedback(
        session ? `Added ${added.join(', ')}.` : 'Items added. Check your cart before checkout.',
        session,
      );
    }
    if (intent.type === 'remove') {
      if (!draft.items.some((i) => i.productId === intent.productId)) {
        await feedback('That item is not in the cart.', session);
        return;
      }
      await update({
        ...draft,
        items: draft.items.filter((i) => i.productId !== intent.productId),
      });
      if (session) await feedback('Item removed.', session);
    }
    if (intent.type === 'undo') {
      const previous = history.current.pop();
      if (previous) {
        await update(previous, false);
        if (session) await feedback('Last change undone.', session);
      } else await feedback('There is nothing to undo.', session);
    }
    if (intent.type === 'checkout' || intent.type === 'credit') {
      const next: Draft = {
        ...draft,
        paymentMethod: intent.type === 'credit' ? 'credit' : intent.method,
        customerId: intent.type === 'credit' ? intent.customerId : null,
      };
      await update(next);
      if (session?.aborted) return;
      const reviewed = await review(next);
      if (session && !session.aborted) {
        const total = `${decimalAmount(reviewed.totalPaise)} rupees`;
        const name = data.customers.find((customer) => customer.id === next.customerId)?.name;
        const phrase = next.paymentMethod === 'credit' ? confirmCredit : confirmPayment;
        const summary =
          next.paymentMethod === 'credit'
            ? `${total} on credit for ${name}.`
            : `${total} by ${next.paymentMethod === 'upi' ? 'U P I' : 'cash'}.`;
        const readback = `${summary} Say Munim, ${phrase}, or Munim, cancel.`;
        notify(readback);
        if ((await voice.speak(readback, session)) && !session.aborted) {
          spokenApproval.current = {
            quote: reviewed.quote,
            phrase,
            expiresAt: Math.min(Date.now() + 30000, reviewed.expiresAt),
            session,
          };
        } else if (!session.aborted) {
          notify('Could not read back the total. Review and confirm on screen.');
        }
      }
    }
    if (intent.type === 'restock') {
      if (offline) throw new Error('Go online to save this restock request.');
      const { type: _, ...body } = intent;
      await durableWrite(`${userId}:${data.settings.id}`, `${base}/restock-requests`, body);
      await feedback('Added to your wholesale list.', session);
      await refresh();
    }
  }
  async function commit(spokenQuote?: string, session?: AbortSignal) {
    if (offline) throw new Error('Go online to complete this bill.');
    if (!draft.attempt && (!preview || (!confirmed && spokenQuote !== preview.quote)))
      throw new Error('Review and confirm the payment or credit first.');
    spokenApproval.current = null;
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
      if (sale.lowStock?.length) await voice.warn(sale.lowStock, session);
      else if (session) await voice.speak('Sale recorded.', session);
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
      ? buildUpiPaymentUri({
          payee: data.settings.upiPayee,
          name: data.settings.upiName ?? data.settings.name,
          amountPaise: preview.totalPaise,
        })
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
                  {preview ? 'Prices verified' : 'Prices checked before billing'}
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
                <p>Waiting for bill confirmation. Cart is locked so it is not billed twice.</p>
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
                onClick={() =>
                  void run(async () => {
                    await review();
                  })
                }
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
                onClick={() =>
                  void run(async () => {
                    await review(draft, true);
                  })
                }
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
                <h3>Bill preview · {inr(preview.totalPaise)}</h3>
                {preview.items.map((i) => (
                  <p key={i.productId}>
                    {i.name} · {i.quantity} {i.baseUnit} · {inr(i.lineTotalPaise)}
                  </p>
                ))}
                {upi ? (
                  <>
                    <QR value={upi} label="Pay this cart with UPI" />
                    <p>Scan to pay. Check that payment arrived before completing the bill.</p>
                  </>
                ) : (
                  <p>
                    {draft.paymentMethod === 'upi'
                      ? 'Add your UPI ID in Manage Store first.'
                      : 'Select UPI to show a payment QR. Digital bills are available after checkout.'}
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
                      setLink(await requestSaleBillQr(base, lastSale.id));
                    })
                  }
                >
                  Share receipt QR
                </button>
                {link && (
                  <div className="qr-panel">
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
                    <p>Valid for 7 days · For this bill only</p>
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
                      Cancel link
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
                  : 'Items running low will show up here.'}
              </p>
            </div>
          </div>
        </aside>
      </div>
      {createPortal(
        <section className="voice-bar" aria-label="Voice and text commands">
          <div className="voice-top">
            <span className={`mic-state ${voice.listening ? 'listening' : ''}`}>
              ●{' '}
              {voice.listening
                ? 'Listening…'
                : voice.active
                  ? 'Voice session on'
                  : 'Voice & text order'}
            </span>
            <small>
              {voice.interim ||
                (offline
                  ? 'Offline · Draft commands only'
                  : agentFallback
                    ? 'OpenAI unavailable · Using local commands'
                    : voice.active
                      ? 'Start each command with “Munim”'
                      : 'Speak or type in Hinglish or English')}
            </small>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (recordingActive) return;
              const transcript = text.replace(/^\s*munim\b[\s,.:!?-]*/i, '').trim();
              void run(() => command(transcript, { kind: 'transcript' }));
            }}
          >
            <input
              aria-label="Command transcript"
              placeholder="Try: 1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet"
              value={text}
              maxLength={1000}
              disabled={disabled || recordingActive}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className="mic icon-btn"
              aria-label={voice.active ? 'Stop voice session' : 'Start voice session'}
              title={voice.active ? 'Stop voice session' : 'Speak order'}
              disabled={
                !voice.active && (disabled || offline || !voice.supported || recordingActive)
              }
              onClick={() => {
                if (voice.active) voice.stop();
                else voice.start();
              }}
            >
              {voice.active ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              )}
            </button>
            <button className="primary" disabled={disabled || recordingActive || !text.trim()}>
              Use command →
            </button>
          </form>
          {recording.supported && (
            <div className="voice-recording">
              {recordingActive ? (
                <>
                  <button
                    type="button"
                    className="mic"
                    disabled={
                      recording.phase === 'requesting' || recording.phase === 'transcribing'
                    }
                    onClick={recording.transcribeRecording}
                  >
                    {recording.phase === 'requesting'
                      ? 'Opening microphone…'
                      : recording.phase === 'transcribing'
                        ? 'Transcribing…'
                        : 'Transcribe recording'}
                  </button>
                  <button type="button" className="mic" onClick={recording.discard}>
                    Discard
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="mic"
                  disabled={disabled || offline || voice.active}
                  onClick={() => {
                    voice.stop();
                    void recording.start();
                  }}
                >
                  Record command
                </button>
              )}
              {recording.phase === 'recording' && <small>Recording…</small>}
            </div>
          )}
          {!voice.supported && (
            <small>
              Voice mic is not supported in this browser. Type your order or tap an example above.
            </small>
          )}
        </section>,
        document.body,
      )}
    </>
  );
}
