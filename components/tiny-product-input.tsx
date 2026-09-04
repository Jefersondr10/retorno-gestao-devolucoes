'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';

type TinyProduct = { id: string; name: string; sku: string; gtin: string };

export function TinyProductInput({ value, onChange, onSelectSku, placeholder = 'Nome, SKU ou código de barras' }: { value: string; onChange: (value: string) => void; onSelectSku?: (sku: string) => void; placeholder?: string }) {
  const [items, setItems] = useState<TinyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (value.trim().length < 2 || !open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiFetch(`/api/tiny/products?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal });
        const result = (await response.json()) as { items?: TinyProduct[] };
        if (response.ok) setItems(result.items || []);
      } catch { /* O preenchimento manual continua disponível. */ }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, value]);

  return <div className="relative">
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-11 pl-9 pr-9" value={value} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 160)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} placeholder={placeholder} autoComplete="off" />{loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-primary" />}</div>
    {open && value.trim().length >= 2 && items.length > 0 && <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">{items.map((product) => <button key={product.id} type="button" className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(product.name); onSelectSku?.(product.sku); setOpen(false); }}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Check className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{product.name}</span><span className="block truncate text-xs text-muted-foreground">{product.sku ? `SKU ${product.sku}` : product.gtin ? `GTIN ${product.gtin}` : 'Produto Tiny'}</span></span></button>)}</div>}
  </div>;
}
