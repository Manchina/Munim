import type { FormEvent, ReactNode } from 'react';
export function fields(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return new FormData(e.currentTarget);
}
export const str = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
export const num = (f: FormData, key: string) => Number(str(f, key));
export const aliasList = (f: FormData) =>
  str(f, 'aliases')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export function paise(s: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error('Enter a valid rupee amount with up to two decimal places.');
  const [whole, fraction = ''] = s.split('.');
  const value = Number(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(value)) throw new Error('Amount is too large.');
  return value;
}
export function Field({
  name,
  label,
  value,
  type = 'text',
  required = true,
  step,
  min = '0',
}: {
  name: string;
  label: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? ''}
        required={required}
        min={min}
        step={step}
        maxLength={type === 'text' ? 160 : undefined}
      />
    </label>
  );
}
export function Select({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value?: string | null;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value ?? ''}>
        {children}
      </select>
    </label>
  );
}
