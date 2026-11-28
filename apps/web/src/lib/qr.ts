import QRCode from 'qrcode';
import { api, decimalAmount } from './api';

export type BillQrLink = {
  id: string;
  url: string;
  qrDataUrl: string;
};

/** Generate a PNG data URL for any bill receipt link or UPI payment URI. */
export function createBillQrDataUrl(value: string, width = 280): Promise<string> {
  return QRCode.toDataURL(value, { width, margin: 2, errorCorrectionLevel: 'M' });
}

/** Build an amount-specific UPI payment URI for an unpaid cart. */
export function buildUpiPaymentUri({
  payee,
  name,
  amountPaise,
}: {
  payee: string;
  name: string;
  amountPaise: number;
}): string {
  return `upi://pay?${new URLSearchParams({
    pa: payee,
    pn: name,
    am: decimalAmount(amountPaise),
    cu: 'INR',
  })}`;
}

/** Issue a scoped digital receipt link for a completed sale and generate its QR image. */
export async function requestSaleBillQr(base: string, saleId: string): Promise<BillQrLink> {
  const link = await api<{ id: string; url: string }>(`${base}/sales/${saleId}/receipt-links`, 'POST');
  const qrDataUrl = await createBillQrDataUrl(link.url);
  return { ...link, qrDataUrl };
}

