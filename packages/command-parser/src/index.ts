import { normalize, type Product, type Customer } from '@munim/contracts';
type Context = { products: Product[]; customers: Customer[]; pavGrams: number | null };
export type Intent =
  | { type: 'add'; items: { productId: string; quantity: number }[] }
  | { type: 'checkout'; method: 'cash' | 'upi' }
  | { type: 'credit'; customerId: string }
  | { type: 'restock'; productId: string | null; name: string; variant: string }
  | { type: 'undo' }
  | { type: 'remove'; productId: string }
  | { type: 'ambiguous'; message: string; candidates: string[] }
  | { type: 'unsupported'; message: string };
const unsupported = (message: string): Intent => ({ type: 'unsupported', message });
const ambiguous = (names: string[]): Intent => ({
  type: 'ambiguous',
  message: 'Please choose a specific match.',
  candidates: names,
});
const clean = (s: string) =>
  normalize(s)
    .replace(/[!?]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function matches(name: string, products: Product[]) {
  return products.filter(
    (p) =>
      !p.archivedAt &&
      [p.name, `${p.name} ${p.variant}`, ...p.aliases].map(clean).includes(clean(name)),
  );
}
export function parseCommand(raw: string, ctx: Context): Intent {
  const s = clean(raw);
  if (!s || s.length > 1000) return unsupported('Enter a command of up to 1,000 characters.');
  if (/^(undo|wapas|undo last)$/.test(s)) return { type: 'undo' };
  if (/^(checkout|check out|bill|cash checkout|upi checkout)$/.test(s))
    return { type: 'checkout', method: s.startsWith('upi') ? 'upi' : 'cash' };
  const credit =
    s.match(/^(.+?)(?: bhai)? ke khate mein (?:likh|daal) do$/) ?? s.match(/^credit (.+)$/);
  if (credit) {
    const name = credit[1]!;
    const found = ctx.customers.filter(
      (c) => !c.archivedAt && [c.name, ...c.aliases].some((n) => clean(n) === name),
    );
    return found.length === 1
      ? { type: 'credit', customerId: found[0]!.id }
      : found.length > 1
        ? ambiguous(found.map((c) => c.name))
        : unsupported(`Customer “${name}” was not found. Add or choose the customer.`);
  }
  const remove = s.match(/^(?:remove|hatao) (.+)$/);
  if (remove) {
    const found = matches(remove[1]!, ctx.products);
    return found.length === 1
      ? { type: 'remove', productId: found[0]!.id }
      : found.length > 1
        ? ambiguous(found.map((p) => `${p.name} ${p.variant}`))
        : unsupported('Choose the cart line to remove.');
  }
  if (/restock|nahi hai/.test(s)) {
    const name = s
      .replace(/\b(?:nahi hai|restock list mein daal do|add to restock|restock)\b/g, '')
      .replace(/,/g, '')
      .trim();
    if (!name) return unsupported('Which product should be requested?');
    const found = matches(name, ctx.products);
    if (found.length > 1) return ambiguous(found.map((p) => `${p.name} ${p.variant}`));
    const size = name.match(/\b(\d+\s*(?:kg|g|ml|l))\b/);
    return {
      type: 'restock',
      productId: found[0]?.id ?? null,
      name: found[0]?.name ?? name.replace(size?.[0] ?? '$^', '').trim(),
      variant: found[0]?.variant ?? size?.[1] ?? '',
    };
  }
  const items: { productId: string; quantity: number }[] = [];
  for (const part of s.split(/\s*,\s*(?:(?:aur|and)\s+)?|\s+(?:aur|and)\s+/)) {
    const v = part
      .replace(/^aadha\s+(?:kilo|kg)\s+/, '0.5 kg ')
      .replace(/^pav\s+/, '1 pav ')
      .replace(/^(ek|one)\s+/, '1 ')
      .replace(/^(do|two)\s+/, '2 ')
      .replace(/^(teen|three)\s+/, '3 ');
    const m = v.match(
      /^(\d+(?:\.\d+)?)\s*(kilo|kilograms?|kg|grams?|g|pav|ser|packets?|pieces?)?\s+(.+)$/,
    );
    if (!m) return unsupported(`Specify a quantity and product for “${part}”.`);
    const n = Number(m[1]),
      unit = m[2] ?? '',
      name = m[3]!;
    if (unit === 'ser' || (unit === 'pav' && !ctx.pavGrams))
      return unsupported(`Configure or clarify the measure “${unit}”.`);
    const found = matches(name, ctx.products);
    if (found.length > 1) return ambiguous(found.map((p) => `${p.name} ${p.variant}`));
    if (!found.length) return unsupported(`Product “${name}” was not found.`);
    const p = found[0]!;
    const weight = /^(kilo|kilogram|kilograms|kg|gram|grams|g|pav)$/.test(unit);
    if ((p.baseUnit === 'gram' && !weight) || (p.baseUnit === 'each' && weight))
      return unsupported(
        `Use ${p.baseUnit === 'gram' ? 'grams or kilos' : 'counts'} for ${p.name}.`,
      );
    const q =
      n * (/^(kilo|kilogram|kilograms|kg)$/.test(unit) ? 1000 : unit === 'pav' ? ctx.pavGrams! : 1);
    if (!Number.isSafeInteger(q) || q <= 0 || q > 2_000_000_000)
      return unsupported('Quantity must be a positive whole gram or count.');
    items.push({ productId: p.id, quantity: q });
  }
  return { type: 'add', items };
}
