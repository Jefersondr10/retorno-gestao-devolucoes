import type { CSSProperties } from 'react';

export const namedStatusClasses: Record<string, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

const namedHex: Record<string, string> = {
  amber: '#b45309',
  blue: '#2563eb',
  sky: '#0284c7',
  orange: '#ea580c',
  violet: '#7c3aed',
  emerald: '#059669',
  rose: '#e11d48',
  slate: '#475569',
};

export function statusClass(color: string) {
  return namedStatusClasses[color] || '';
}

export function statusStyle(color: string): CSSProperties | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  return {
    color,
    borderColor: `${color}55`,
    backgroundColor: `${color}12`,
  };
}

export function statusDotStyle(color: string): CSSProperties {
  return { backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? color : namedHex[color] || namedHex.slate };
}
