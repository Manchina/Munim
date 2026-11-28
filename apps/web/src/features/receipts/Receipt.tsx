import { useEffect, useState } from 'react';
import type { SaleLine } from '@munim/contracts';
import { api, inr } from '../../lib/api';
import { createBillQrDataUrl } from '../../lib/qr';
export function QR({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    setSrc('');
    void createBillQrDataUrl(value).then((s) => {
      if (active) setSrc(s);
    });
    return () => {
      active = false;
    };
  }, [value]);
  return src ? (
    <img className="qr" src={src} alt={label} width="280" height="280" />
  ) : (
    <p>Preparing QR…</p>
  );
}
export function Receipt({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<{
      storeName: string;
      createdAt: string;
      totalPaise: number;
      paymentStatus: string;
      items: Omit<SaleLine, 'productId'>[];
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    void api<typeof receipt>(`/receipts/${token}`)
      .then(setReceipt)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="auth receipt">
      <div className="wordmark">
        Munim<span>●</span>
      </div>
      {error ? (
        <p role="alert">This receipt is unavailable or has expired.</p>
      ) : !receipt ? (
        <p>Opening receipt…</p>
      ) : (
        <>
          <p className="eyebrow">DIGITAL RECEIPT</p>
          <h1>{receipt.storeName}</h1>
          <p>{new Date(receipt.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
          {receipt.items.map((i, n) => (
            <div className="receipt-line" key={n}>
              <span>
                {i.name} {i.variant}
                <small>
                  {i.quantity} {i.baseUnit === 'gram' ? 'g' : '×'} · {inr(i.pricePaise)} /{' '}
                  {i.priceQuantity} {i.baseUnit}
                </small>
              </span>
              <strong>{inr(i.lineTotalPaise)}</strong>
            </div>
          ))}
          <div className="receipt-line">
            <h2>Total</h2>
            <h2>{inr(receipt.totalPaise)}</h2>
          </div>
          <p>
            {receipt.paymentStatus === 'merchant_confirmed_paid'
              ? 'Payment confirmed by merchant'
              : 'Udhaar (credit) bill'}
          </p>
          <small>Thank you for shopping locally.</small>
        </>
      )}
    </main>
  );
}
