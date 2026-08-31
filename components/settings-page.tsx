'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Image,
  Loader2,
  PackageCheck,
  Plus,
  Settings2,
  Tags,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { StatusDefinition } from '@/lib/returns';

const colorLabels = [
  ['slate', 'Cinza'],
  ['amber', 'Âmbar'],
  ['blue', 'Azul'],
  ['sky', 'Azul-claro'],
  ['orange', 'Laranja'],
  ['violet', 'Violeta'],
  ['emerald', 'Verde'],
  ['rose', 'Rosa'],
] as const;

const tone: Record<string, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function SettingsPage() {
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('slate');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config/statuses')
      .then(async (response) => {
        const result = (await response.json()) as { items?: StatusDefinition[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as configurações.');
        return result.items || [];
      })
      .then((items) => !cancelled && setStatuses(items))
      .catch((requestError) => !cancelled && setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as configurações.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim()) return;
    setError('');
    setSaving(true);
    try {
      const response = await fetch('/api/config/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, color }),
      });
      const result = (await response.json()) as { item?: StatusDefinition; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível cadastrar o status.');
      setStatuses((current) => [...current, result.item as StatusDefinition]);
      setLabel('');
      setColor('slate');
      setNotice(`Status “${result.item.label}” cadastrado com sucesso.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível cadastrar o status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="grid size-11 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Voltar às pendências">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><PackageCheck className="size-5" /></div>
          <div>
            <p className="text-base font-bold">Configurações</p>
            <p className="text-xs text-muted-foreground">Retorno · Gestão de devoluções</p>
          </div>
          <Button className="ml-auto hidden h-10 rounded-xl sm:inline-flex" onClick={() => { window.location.href = '/receber'; }}><Plus /> Nova devolução</Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-10">
        <aside>
          <nav aria-label="Seções de configurações" className="sticky top-24 grid gap-1 rounded-2xl border bg-card p-2 shadow-sm">
            <a href="#status" className="flex min-h-11 items-center gap-3 rounded-xl bg-primary/9 px-3 text-sm font-semibold text-primary"><Tags className="size-[18px]" /> Status operacionais</a>
            <a href="#finalizacao" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted"><FileCheck2 className="size-[18px]" /> Finalização segura</a>
            <a href="#fotos" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted"><Image className="size-[18px]" /> Fotos e envio</a>
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <div>
            <p className="text-sm font-semibold text-primary">Administração</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.035em] sm:text-3xl">Preferências do sistema</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Organize as etapas internas sem alterar as regras que protegem a finalização de cada devolução.</p>
          </div>

          <Card id="status" className="scroll-mt-24 border-0 bg-card p-5 shadow-[0_12px_38px_rgb(28_39_36/7%)] ring-border/80 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Settings2 className="size-5" /></span>
              <div><h2 className="font-bold">Status operacionais</h2><p className="mt-1 text-sm text-muted-foreground">Crie etapas próprias, como “Aguardando assistência” ou “Separado para conferência”.</p></div>
            </div>

            {loading ? (
              <div className="grid min-h-32 place-items-center text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border bg-muted/30 p-4">
                {statuses.map((status) => (
                  <Badge key={status.code} variant="outline" className={tone[status.color] || tone.slate}>
                    {status.label}{status.is_system ? '' : ' · personalizado'}
                  </Badge>
                ))}
              </div>
            )}

            <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="status-name">Nome do novo status</Label>
                <Input id="status-name" className="h-11" placeholder="Ex.: Aguardando assistência" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status-color">Cor</Label>
                <NativeSelect id="status-color" className="w-full" value={color} onChange={(event) => setColor(event.target.value)}>
                  {colorLabels.map(([value, name]) => <NativeSelectOption key={value} value={value}>{name}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <Button type="submit" className="h-11 rounded-xl" disabled={saving || !label.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Plus />} Cadastrar
              </Button>
            </form>

            {error && <Alert variant="destructive" className="mt-4"><AlertCircle /><AlertTitle>Não foi possível salvar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          </Card>

          <Card id="finalizacao" className="scroll-mt-24 border-0 bg-card p-5 shadow-[0_12px_38px_rgb(28_39_36/7%)] ring-border/80 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><FileCheck2 className="size-5" /></span>
              <div><h2 className="font-bold">Finalização segura</h2><p className="mt-1 text-sm text-muted-foreground">Estas regras são obrigatórias em todas as devoluções.</p></div>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {['Loja e identificação preenchidas', 'Todos os produtos com condição definida', 'Destino de cada produto definido', 'Nota de entrada informada', 'Teste concluído quando necessário'].map((rule) => (
                <li key={rule} className="flex items-start gap-2.5 rounded-xl border bg-muted/20 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {rule}</li>
              ))}
            </ul>
          </Card>

          <Card id="fotos" className="scroll-mt-24 border-0 bg-card p-5 shadow-[0_12px_38px_rgb(28_39_36/7%)] ring-border/80 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sky-700"><Image className="size-5" /></span>
              <div><h2 className="font-bold">Fotos e envio</h2><p className="mt-1 text-sm text-muted-foreground">Limites atuais do recebimento pelo celular.</p></div>
            </div>
            <dl className="mt-5 grid gap-3 sm:grid-cols-3">
              <Info label="Por devolução" value="Até 8 fotos" />
              <Info label="Por arquivo" value="Até 10 MB" />
              <Info label="Acesso" value="Somente autenticado" />
            </dl>
          </Card>
        </main>
      </div>

      {notice && <output className="fixed bottom-5 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl">{notice}</output>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-muted/20 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-bold">{value}</dd></div>;
}
