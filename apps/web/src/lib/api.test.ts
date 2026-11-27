import { it, expect } from 'vitest';
import { decimalAmount, inr } from './api';
it('formats paise and UPI decimal amounts without floating-point loss', () => {
  expect(decimalAmount(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  expect(decimalAmount(1)).toBe('0.01');
  expect(inr(12050)).toBe('₹120.50');
  expect(inr(123456789)).toBe('₹12,34,567.89');
});
