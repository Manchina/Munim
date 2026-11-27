import { describe, it, expect } from 'vitest';
import { parseCommand } from './index';
import type { Product, Customer } from '@munim/contracts';
const p = (
  id: string,
  name: string,
  baseUnit: 'gram' | 'each',
  aliases: string[] = [],
): Product => ({
  id,
  name,
  baseUnit,
  aliases,
  variant: '',
  priceQuantity: baseUnit === 'gram' ? 1000 : 1,
  pricePaise: 10000,
  quantity: 10000,
  safetyStock: 1000,
  supplierId: null,
  sku: null,
  version: 1,
  archivedAt: null,
});
const products = [
  p('dal', 'Toor dal', 'gram'),
  p('soap', 'Lifebuoy', 'each', ['lifebuoy sabun', 'sabun']),
  p('bread', 'Bread', 'each', ['bread packet']),
  p('rice', 'Rice', 'gram'),
];
const customers: Customer[] = [
  { id: 'ramesh', name: 'Ramesh', phone: null, aliases: [], archivedAt: null },
];
const ctx = { products, customers, pavGrams: null };
describe('command parser', () => {
  it('parses mixed Hinglish connectors and product aliases', () =>
    expect(parseCommand('1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet', ctx)).toEqual({
      type: 'add',
      items: [
        { productId: 'dal', quantity: 1000 },
        { productId: 'soap', quantity: 2 },
        { productId: 'bread', quantity: 1 },
      ],
    }));
  it('supports spoken halves and decimal kilos', () => {
    for (const text of ['aadha kilo rice', '0.5 kg rice'])
      expect(parseCommand(text, ctx)).toEqual({
        type: 'add',
        items: [{ productId: 'rice', quantity: 500 }],
      });
  });
  it('requires store-specific measures to be configured', () => {
    expect(parseCommand('1 pav rice', ctx).type).toBe('unsupported');
    expect(parseCommand('1 ser rice', ctx).type).toBe('unsupported');
    expect(parseCommand('1 pav rice', { ...ctx, pavGrams: 250 })).toEqual({
      type: 'add',
      items: [{ productId: 'rice', quantity: 250 }],
    });
  });
  it('keeps variant size separate from order quantity', () =>
    expect(parseCommand('Amul butter 500g nahi hai, restock list mein daal do.', ctx)).toEqual({
      type: 'restock',
      productId: null,
      name: 'amul butter',
      variant: '500g',
    }));
  it('resolves credit assignment without executing it', () =>
    expect(parseCommand('Ramesh bhai ke khate mein likh do', ctx)).toEqual({
      type: 'credit',
      customerId: 'ramesh',
    }));
  it('returns ambiguity and refuses incompatible quantities', () => {
    expect(
      parseCommand('1 bread packet', {
        ...ctx,
        products: [...products, p('other', 'Bread', 'each', ['bread packet'])],
      }).type,
    ).toBe('ambiguous');
    for (const text of [
      '0 bread',
      '1 kg bread',
      '1 rice',
      '1.2 sabun',
      'noise here',
      '1 kg rice and nonexistent',
    ])
      expect(parseCommand(text, ctx).type).toBe('unsupported');
  });
  it('supports correction and undo', () => {
    expect(parseCommand('undo', ctx)).toEqual({ type: 'undo' });
    expect(parseCommand('remove sabun', ctx)).toEqual({ type: 'remove', productId: 'soap' });
  });
});
