import { it, expect } from 'vitest';
import { lineTotal, sumMoney, cartInput } from './index';
it('rounds half paise up per line and sums rounded lines', () => {
  expect(lineTotal(101, 500, 1000)).toBe(51);
  expect(sumMoney([51, 51])).toBe(102);
  expect(lineTotal(12000, 250, 1000)).toBe(3000);
});
it('rejects unsupported amounts and credit without a customer', () => {
  expect(() => lineTotal(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow();
  expect(() => lineTotal(1, 1, 0)).toThrow();
  expect(
    cartInput.safeParse({
      items: [{ productId: crypto.randomUUID(), quantity: 1 }],
      paymentMethod: 'credit',
    }).success,
  ).toBe(false);
});
