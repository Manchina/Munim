import { z } from 'zod';
export const id = z.string().uuid();
export const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const quantity = z.number().int().positive().max(2_000_000_000);
export const text = z.string().trim().min(1).max(160);
export const normalize = (s: string) =>
  s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
export const loginInput = z
  .object({
    email: z.string().email().max(254).transform(normalize),
    password: z.string().min(12).max(128),
  })
  .strict();
export const inviteInput = z
  .object({ email: z.string().email().max(254).transform(normalize) })
  .strict();
export const acceptInviteInput = z
  .object({ token: z.string().length(43), password: z.string().min(12).max(128).optional() })
  .strict();
export const settingsInput = z
  .object({
    name: text,
    creditConfirmationThresholdPaise: amount,
    pavGrams: quantity.nullable(),
    upiPayee: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/)
      .max(200)
      .nullable(),
    upiName: text.nullable(),
    expectedVersion: quantity,
  })
  .strict();
export const productInput = z
  .object({
    name: text,
    variant: z.string().trim().max(100).default(''),
    sku: text.nullable().default(null),
    baseUnit: z.enum(['gram', 'each']),
    priceQuantity: quantity,
    pricePaise: amount,
    safetyStock: amount.max(2_000_000_000),
    supplierId: id.nullable().default(null),
    aliases: z.array(text).max(30).default([]),
    openingStock: amount.max(2_000_000_000).default(0),
  })
  .strict();
export const productUpdate = productInput
  .omit({ openingStock: true })
  .extend({ expectedVersion: quantity, archived: z.boolean().default(false) });
export const personInput = z
  .object({
    name: text,
    phone: z
      .string()
      .regex(/^[+\d ()-]{5,24}$/)
      .nullable()
      .default(null),
    aliases: z.array(text).max(20).default([]),
    archived: z.boolean().default(false),
  })
  .strict();
export const supplierInput = personInput.omit({ aliases: true });
export const cartInput = z
  .object({
    items: z
      .array(z.object({ productId: id, quantity }).strict())
      .min(1)
      .max(100),
    paymentMethod: z.enum(['cash', 'upi', 'credit']),
    customerId: id.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.paymentMethod === 'credit' && !v.customerId)
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Choose a customer for credit.',
      });
  });
export const checkoutInput = z
  .object({ quote: z.string().max(40000), confirmed: z.literal(true) })
  .strict();
export const paymentInput = z
  .object({
    amountPaise: amount.refine((n) => n > 0),
    method: z.enum(['cash', 'upi']),
    reference: z.string().trim().max(100).nullable().default(null),
  })
  .strict();
export const receiptInput = z
  .object({
    items: z
      .array(z.object({ productId: id, quantity }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const adjustmentInput = z
  .object({
    productId: id,
    delta: z
      .number()
      .int()
      .min(-2_000_000_000)
      .max(2_000_000_000)
      .refine((n) => n !== 0),
    reason: text,
  })
  .strict();
export const restockInput = z
  .object({
    productId: id.nullable().default(null),
    name: text,
    variant: z.string().trim().max(100).default(''),
    supplierId: id.nullable().default(null),
  })
  .strict();
export const procurementInput = z
  .object({ quantityReceived: amount.max(2_000_000_000).default(0) })
  .strict();
export const pageInput = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().max(160).default(''),
  status: z.enum(['open', 'procured']).default('open'),
});
export type CartInput = z.infer<typeof cartInput>;
export type Product = {
  id: string;
  name: string;
  variant: string;
  baseUnit: 'gram' | 'each';
  priceQuantity: number;
  pricePaise: number;
  safetyStock: number;
  quantity: number;
  supplierId: string | null;
  sku: string | null;
  version: number;
  archivedAt: string | null;
  aliases: string[];
};
export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  aliases: string[];
  archivedAt: string | null;
};
export type Settings = {
  id: string;
  name: string;
  timezone: string;
  creditConfirmationThresholdPaise: number;
  pavGrams: number | null;
  upiPayee: string | null;
  upiName: string | null;
  settingsVersion: number;
};
export type SaleLine = {
  productId: string;
  name: string;
  variant: string;
  baseUnit: 'gram' | 'each';
  quantity: number;
  priceQuantity: number;
  pricePaise: number;
  lineTotalPaise: number;
};
export type Preview = {
  items: SaleLine[];
  totalPaise: number;
  requiresCreditConfirmation: boolean;
  quote: string;
  expiresAt: number;
};
export type Sale = {
  id: string;
  totalPaise: number;
  paymentMethod: 'cash' | 'upi' | 'credit';
  createdAt: string;
  customerId: string | null;
  items?: SaleLine[];
  lowStock?: string[];
};
export type Restock = {
  id: string;
  name: string;
  variant: string;
  productId: string | null;
  supplierId: string | null;
  requestCount: number;
  status: 'open' | 'procured';
};
export type Member = { storeId: string; name: string; role: 'owner' | 'staff' };
export type Me = { id: string; email: string; stores: Member[] };
export type LedgerEntry = {
  id: string;
  kind: 'sale_debit' | 'payment';
  amountPaise: number;
  saleId: string | null;
  method: string | null;
  reference: string | null;
  createdAt: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export function lineTotal(pricePaise: number, qty: number, basis: number): number {
  if (
    ![pricePaise, qty, basis].every(Number.isSafeInteger) ||
    pricePaise < 0 ||
    qty <= 0 ||
    basis <= 0
  )
    throw new Error('Invalid price or quantity');
  const total = (BigInt(pricePaise) * BigInt(qty) + BigInt(basis) / 2n) / BigInt(basis);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount too large');
  return Number(total);
}
export function sumMoney(values: number[]): number {
  const sum = values.reduce((a, b) => a + BigInt(b), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount too large');
  return Number(sum);
}
