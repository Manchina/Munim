import { describe, expect, it } from 'vitest';
import { toBaseUnits } from './units';

describe('stock quantity conversion', () => {
  it('accepts exact whole grams and pieces', () => {
    expect(toBaseUnits(1.001, 'kg')).toBe(1001);
    expect(toBaseUnits(0.29, 'kg')).toBe(290);
    expect(toBaseUnits(3, 'pcs')).toBe(3);
    expect(toBaseUnits(0, 'g')).toBe(0);
  });
  it('rejects fractions of a gram or piece instead of rounding stock', () => {
    expect(() => toBaseUnits(1.5, 'pcs')).toThrow();
    expect(() => toBaseUnits(1.2, 'g')).toThrow();
    expect(() => toBaseUnits(0.0005, 'kg')).toThrow();
    expect(() => toBaseUnits(-1, 'pcs')).toThrow();
  });
});
