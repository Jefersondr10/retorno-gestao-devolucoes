'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Box,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Inbox,
  LayoutDashboard,
  Loader2,
  PackageCheck,
  Search,
  Settings,
  Store,
  TestTube2,
  X,
} from 'lucide-react';

import { ReturnDetailSheet } from '@/components/return-detail-sheet';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ReturnDetail, ReturnSummary, StatusDefinition } from '@/lib/returns';

const statusClasses: Record<string, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function Dashboard() {
  const [items, setItems] = useState<ReturnSummary[]>([]);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [includeFinalized, setIncludeFinalized] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const loadReturns = useCallback(async (query = search, includeClosed = includeFinalized) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (includeClosed) params.set('includeFinalized', 'true');
      const response = await fetch(`/api/returns?${params}`);
      const result = (await response.json()) as { items?: ReturnSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as devoluções.');
      setItems(result.items || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as devoluções.');
    } finally {
      setLoading(false);
    }
  }, [includeFinalized, search]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/config/statuses')
      .then(async (response) => ({ response, result: (await response.json()) as { items?: StatusDefinition[] } }))
      .then(({ response, result }) => { if (!cancelled && response.ok) setStatuses(result.items || []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadReturns(search, includeFinalized), 250);
    return () => window.clearTimeout(timer);
  }, [includeFinalized, loadReturns, search]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleItems = useMemo(
    () => (statusFilter ? items.filter((item) => item.status === statusFilter) : items),
    [items, statusFilter],
  );
  const metrics = useMemo(() => ({
    pending: items.filter((item) => item.status === 'PENDING_INFO').length,
    testing: items.filter((item) => item.status === 'WAITING_TEST').length,
    entry: items.filter((item) => item.status === 'WAITING_ENTRY').length,
    ready: items.filter((item) => item.status === 'READY').length,
  }), [items]);
  const firstPending = items.find((item) => item.status === 'PENDING_INFO');

  function refresh(message?: string) {
    void loadReturns(search, includeFinalized);
    if (message) setNotice(message);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 lg:px-7">
          <div className="flex min-w-fit items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><PackageCheck className="size-5" /></div>
            <div><p className="text-[15px] font-bold leading-none tracking-[-0.02em]">Retorno</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Gestão de devoluções</p></div>
          </div>

          <div className="relative mx-auto hidden w-full max-w-xl md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 rounded-xl bg-card pl-9 pr-10 shadow-xs" placeholder="Buscar rastreio, pedido, protocolo, produto ou nota" aria-label="Buscar devoluções" />
            {search && <button type="button" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted" onClick={() => setSearch('')} aria-label="Limpar busca"><X className="size-4" /></button>}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="lg" className="hidden h-11 rounded-xl px-4 sm:inline-flex" disabled={!firstPending} onClick={() => firstPending && setDetailId(firstPending.id)}><ClipboardCheck /> Completar cadastro</Button>
            <Button size="lg" className="h-11 rounded-xl px-4 shadow-[0_8px_20px_rgb(13_96_83/18%)]" onClick={() => { window.location.href = '/receber'; }}><Camera /><span className="hidden sm:inline">Registrar recebimento</span><span className="sm:hidden">Registrar</span></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r border-border/70 px-3 py-5 lg:block">
          <nav aria-label="Navegação principal" className="space-y-1">
            <NavButton active={!includeFinalized} icon={<LayoutDashboard />} label="Pendências" count={items.filter((item) => item.status !== 'FINALIZED').length} onClick={() => { setIncludeFinalized(false); setStatusFilter(''); }} />
            <NavButton active={includeFinalized} icon={<Box />} label="Todas as devoluções" onClick={() => { setIncludeFinalized(true); setStatusFilter(''); }} />
            <NavButton icon={<Store />} label="Lojas" onClick={() => setNotice('O filtro por loja já está disponível pela busca. O cadastro próprio de lojas entra na próxima etapa.')} />
            <NavButton icon={<Settings />} label="Configurações" onClick={() => { window.location.href = '/configuracoes'; }} />
          </nav>
          <div className="absolute inset-x-3 bottom-5 rounded-2xl border border-primary/15 bg-primary/[0.055] p-3.5"><p className="text-xs font-bold text-primary">Fluxo seguro</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Só é possível finalizar após classificar os itens e informar a nota de entrada.</p></div>
        </aside>

        <main className="min-w-0 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-sm font-semibold text-primary">{todayLabel()}</p><h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] sm:text-[28px]">{includeFinalized ? 'Todas as devoluções' : 'Fila de devoluções'}</h1><p className="mt-1 text-sm text-muted-foreground">{includeFinalized ? 'Consulte registros abertos e finalizados.' : 'Comece pelas devoluções que precisam de ação.'}</p></div>
              <div className="relative md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 rounded-xl bg-card pl-9" placeholder="Buscar devolução" aria-label="Buscar devolução" /></div>
            </div>

            <section aria-label="Resumo das pendências" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Metric icon={<Camera />} label="Novas por foto" value={metrics.pending} accent="bg-amber-100 text-amber-800" active={statusFilter === 'PENDING_INFO'} onClick={() => setStatusFilter(statusFilter === 'PENDING_INFO' ? '' : 'PENDING_INFO')} />
              <Metric icon={<TestTube2 />} label="Aguardando teste" value={metrics.testing} accent="bg-sky-100 text-sky-800" active={statusFilter === 'WAITING_TEST'} onClick={() => setStatusFilter(statusFilter === 'WAITING_TEST' ? '' : 'WAITING_TEST')} />
              <Metric icon={<FileText />} label="Aguardando nota" value={metrics.entry} accent="bg-violet-100 text-violet-800" active={statusFilter === 'WAITING_ENTRY'} onClick={() => setStatusFilter(statusFilter === 'WAITING_ENTRY' ? '' : 'WAITING_ENTRY')} />
              <Metric icon={<CheckCircle2 />} label="Prontas para finalizar" value={metrics.ready} accent="bg-emerald-100 text-emerald-800" active={statusFilter === 'READY'} onClick={() => setStatusFilter(statusFilter === 'READY' ? '' : 'READY')} extraClass="col-span-2 xl:col-span-1" />
            </section>

            {statuses.length > 0 && (
              <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                <Button size="sm" variant={statusFilter ? 'outline' : 'secondary'} className="shrink-0" onClick={() => setStatusFilter('')}>Todas</Button>
                {statuses.filter((status) => includeFinalized || status.code !== 'FINALIZED').map((status) => (
                  <Button key={status.code} size="sm" variant={statusFilter === status.code ? 'secondary' : 'outline'} className="shrink-0" onClick={() => setStatusFilter(statusFilter === status.code ? '' : status.code)}>{status.label}</Button>
                ))}
              </div>
            )}

            <section className="mt-7">
              <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-bold tracking-tight">{statusFilter ? statuses.find((status) => status.code === statusFilter)?.label || 'Resultados' : search ? 'Resultados da busca' : 'Prioridade agora'}</h2><p className="text-xs text-muted-foreground">{visibleItems.length} {visibleItems.length === 1 ? 'devolução encontrada' : 'devoluções encontradas'}</p></div>{(statusFilter || search) && <Button variant="ghost" className="text-primary" onClick={() => { setStatusFilter(''); setSearch(''); }}>Limpar filtros <X /></Button>}</div>

              {error ? (
                <Alert variant="destructive"><X /><AlertTitle>Não foi possível carregar</AlertTitle><AlertDescription>{error} <button className="font-semibold underline" onClick={() => loadReturns()}>Tentar novamente</button></AlertDescription></Alert>
              ) : loading ? (
                <div className="grid min-h-56 place-items-center text-muted-foreground"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin" /><p className="mt-2 text-sm">Atualizando a fila...</p></div></div>
              ) : visibleItems.length === 0 ? (
                <EmptyState hasFilters={Boolean(search || statusFilter)} onCreate={() => { window.location.href = '/receber'; }} onClear={() => { setSearch(''); setStatusFilter(''); }} />
              ) : (
                <div className="grid gap-3 xl:grid-cols-3">
                  {visibleItems.map((item) => <ReturnCard key={item.id} item={item} onOpen={() => setDetailId(item.id)} />)}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      <nav aria-label="Navegação móvel" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-border/80 bg-card/95 px-2 py-2 shadow-[0_14px_50px_rgb(25_35_32/18%)] backdrop-blur-xl lg:hidden">
        <MobileNav icon={<LayoutDashboard />} label="Pendências" active={!includeFinalized} onClick={() => { setIncludeFinalized(false); setStatusFilter(''); }} />
        <MobileNav icon={<Camera />} label="Nova" onClick={() => { window.location.href = '/receber'; }} />
        <MobileNav icon={<Search />} label="Buscar" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Buscar devolução"]')?.focus()} />
        <MobileNav icon={<Settings />} label="Mais" onClick={() => { window.location.href = '/configuracoes'; }} />
      </nav>

      {notice && <output className="fixed bottom-24 left-1/2 z-50 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl lg:bottom-6">{notice}</output>}

      <ReturnDetailSheet open={Boolean(detailId)} returnId={detailId} statuses={statuses} onOpenChange={(open) => !open && setDetailId(null)} onChanged={(item: ReturnDetail) => refresh(item.status === 'FINALIZED' ? `${item.protocol} finalizada.` : 'Alterações salvas.')} />
    </div>
  );
}

function ReturnCard({ item, onOpen }: { item: ReturnSummary; onOpen: () => void }) {
  return (
    <Card className="border-0 bg-card py-0 shadow-[0_10px_34px_rgb(28_39_36/6%)] ring-border/80 transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgb(28_39_36/10%)]">
      <button type="button" aria-label={`Abrir ${item.protocol}`} className="w-full p-4 text-left" onClick={onOpen}>
        <div className="flex items-start gap-3">
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
            {item.first_photo_id ? (
              // Dynamic private photos are intentionally served without public image optimization.
              // eslint-disable-next-line next/no-img-element
              <img src={`/api/photos/${item.first_photo_id}`} alt="" className="h-full w-full object-cover" />
            ) : <Box className="size-5" />}
          </div>
          <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="font-bold">{item.protocol}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.store || 'Loja ainda não informada'}</p></div><Badge variant="outline" className={statusClasses[item.status_color] || statusClasses.slate}>{item.status_label}</Badge></div></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">Identificação</p><p className="mt-1 truncate font-semibold">{item.tracking_code || item.order_id || 'Dados pendentes'}</p></div><div><p className="text-muted-foreground">Itens e fotos</p><p className="mt-1 font-semibold">{item.item_count} {item.item_count === 1 ? 'item' : 'itens'} · {item.photo_count} {item.photo_count === 1 ? 'foto' : 'fotos'}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t pt-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> {relativeDate(item.received_at)}</p><span className="flex items-center gap-1 text-xs font-semibold text-primary">Abrir <ArrowRight className="size-3.5" /></span></div>
      </button>
    </Card>
  );
}

function Metric({ icon, label, value, accent, active, onClick, extraClass = '' }: { icon: React.ReactNode; label: string; value: number; accent: string; active: boolean; onClick: () => void; extraClass?: string }) {
  return <Card className={`border-0 bg-card py-0 shadow-[0_8px_26px_rgb(28_39_36/5%)] ring-border/80 ${active ? 'ring-2 ring-primary' : ''} ${extraClass}`}><button type="button" className="flex w-full items-center gap-3 p-3 text-left sm:p-4" onClick={onClick}><span className={`grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-[18px] ${accent}`}>{icon}</span><div className="min-w-0"><p className="text-xl font-extrabold leading-none tracking-tight">{value}</p><p className="mt-1 truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p></div></button></Card>;
}

function NavButton({ icon, label, count, active = false, onClick }: { icon: React.ReactNode; label: string; count?: number; active?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${active ? 'bg-primary/9 font-semibold text-primary' : 'font-medium text-muted-foreground hover:bg-muted'}`}><span className="[&>svg]:size-[18px]">{icon}</span>{label}{typeof count === 'number' && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">{count}</span>}</button>;
}

function MobileNav({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold [&>svg]:size-[19px] ${active ? 'bg-primary/9 text-primary' : 'text-muted-foreground'}`} onClick={onClick}>{icon}{label}</button>;
}

function EmptyState({ hasFilters, onCreate, onClear }: { hasFilters: boolean; onCreate: () => void; onClear: () => void }) {
  return <div className="rounded-3xl border border-dashed bg-card/60 px-6 py-14 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Inbox className="size-7" /></div><h3 className="mt-4 text-lg font-bold">{hasFilters ? 'Nenhuma devolução encontrada' : 'A fila está vazia'}</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{hasFilters ? 'Tente remover os filtros ou buscar por outro termo.' : 'Registre o primeiro recebimento por foto ou preencha o cadastro completo.'}</p><div className="mt-5 flex justify-center gap-2">{hasFilters && <Button variant="outline" className="h-11" onClick={onClear}>Limpar filtros</Button>}<Button className="h-11" onClick={onCreate}><Camera /> Registrar recebimento</Button></div></div>;
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');
  return formatter.format(Math.round(diffHours / 24), 'day');
}

function todayLabel() {
  const text = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return text.charAt(0).toUpperCase() + text.slice(1);
}
