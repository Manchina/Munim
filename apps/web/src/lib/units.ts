import type { Product } from '@munim/contracts';
import { inr } from './api';

export type BaseUnit = Product['baseUnit'];
export type DisplayUnit = 'kg' | 'g' | 'pcs';

/** Format a base-unit quantity into shopkeeper-friendly units (e.g. 2.5 kg, 500 g, 12 pcs). */
export function formatStockQty(quantity: number, baseUnit: BaseUnit): string {
  if (baseUnit === 'each') return `${quantity} ${quantity === 1 ? 'pc' : 'pcs'}`;
  if (quantity >= 1000) {
    const kg = quantity / 1000;
    const text = Number.isInteger(kg) ? String(kg) : Number(kg.toFixed(3)).toString();
    return `${text} kg`;
  }
  return `${quantity} g`;
}

/** Format a product's price in shopkeeper terms (e.g. ₹80.00 / kg or ₹20.00 / pc). */
export function formatUnitPrice(
  pricePaise: number,
  priceQuantity: number,
  baseUnit: BaseUnit,
): string {
  if (baseUnit === 'gram' && priceQuantity === 1000) return `${inr(pricePaise)} / kg`;
  if (baseUnit === 'each' && priceQuantity === 1) return `${inr(pricePaise)} / pc`;
  return `${inr(pricePaise)} / ${formatStockQty(priceQuantity, baseUnit)}`;
}

/** Convert a user-entered display quantity ('kg', 'g', or 'pcs') into integer base units. */
export function toBaseUnits(amount: number, unit: DisplayUnit): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Enter a valid quantity.');
  }
  const raw = unit === 'kg' ? amount * 1000 : amount;
  const value = Math.round(raw);
  if (!Number.isSafeInteger(value) || Math.abs(raw - value) > 1e-7) {
    throw new Error('Use whole pieces or whole grams (up to 3 decimal places in kg).');
  }
  return value;
}

/** Convert integer base units into a default display number ('kg' when >= 1000g or for kg inputs, else 'g'/'pcs'). */
export function fromBaseUnits(quantity: number, baseUnit: BaseUnit, asKg = false): string {
  if (baseUnit === 'each') return String(quantity);
  if (asKg) return Number((quantity / 1000).toFixed(3)).toString();
  return String(quantity);
}
