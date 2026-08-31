'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Archive,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileText,
  Inbox,
  LayoutDashboard,
  ListFilter,
  Loader2,
  PackageCheck,
  Search,
  Settings,
  Store,
  TestTube2,
  Trash2,
  X,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ReturnWorkspace } from '@/components/return-workspace';
import type { ConfigOptionsResponse, ReturnSummary, StatusDefinition } from '@/lib/returns';
import { statusClass, statusDotStyle, statusStyle } from '@/lib/status-colors';

export function Dashboard() {
  const [items, setItems] = useState<ReturnSummary[]>([]);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [configuredStores, setConfiguredStores] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'pending' | 'finalized'>('pending');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState('');
  const [notice, setNotice] = useState('');

  const loadReturns = useCallback(async (query = search, nextView = viewMode) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (nextView === 'finalized') params.set('status', 'FINALIZED');
      const response = await fetch(`/api/returns?${params}`);
      const result = (await response.json()) as { items?: ReturnSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as devoluções.');
      setItems(result.items || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as devoluções.');
    } finally {
      setLoading(false);
    }
  }, [search, viewMode]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch('/api/config/statuses').then(async (response) => ({ response, result: (await response.json()) as { items?: StatusDefinition[] } })),
      fetch('/api/config/options').then(async (response) => ({ response, result: (await response.json()) as ConfigOptionsResponse })),
    ])
      .then(([statusResponse, optionResponse]) => {
        if (cancelled) return;
        if (statusResponse.response.ok) setStatuses(statusResponse.result.items || []);
        if (optionResponse.response.ok) setConfiguredStores(optionResponse.result.stores.map((store) => store.label));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadReturns(search, viewMode), 250);
    return () => window.clearTimeout(timer);
  }, [loadReturns, search, viewMode]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); }, [notice]);
  const visibleItems = useMemo(
    () => items.filter((item) => (statusFilters.length === 0 || statusFilters.includes(item.status)) && (!storeFilter || item.store === storeFilter)),
    [items, statusFilters, storeFilter],
  );
  const storeOptions = useMemo(() => [...new Set([...configuredStores, ...items.map((item) => item.store).filter((store): store is string => Boolean(store))])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [configuredStores, items]);
  const metrics = useMemo(() => ({
    pending: items.filter((item) => item.status === 'PENDING_INFO').length,
    testing: items.filter((item) => item.status === 'WAITING_TEST').length,
    entry: items.filter((item) => item.status === 'WAITING_ENTRY').length,
    ready: items.filter((item) => item.status === 'READY').length,
  }), [items]);
  const firstPending = items.find((item) => item.status === 'PENDING_INFO');

  function changeView(nextView: 'pending' | 'finalized') {
    setViewMode(nextView);
    setStatusFilters([]);
    setStoreFilter('');
  }

  function toggleStatusFilter(code: string) {
    setStatusFilters((current) => current.includes(code) ? current.filter((statusCode) => statusCode !== code) : [...current, code]);
  }

  async function deleteReturn(item: ReturnSummary) {
    const confirmation = window.prompt(`Para excluir definitivamente ${item.protocol}, digite o protocolo abaixo:`);
    if (confirmation !== item.protocol) return;
    setDeletingId(item.id);
    setError('');
    try {
      const response = await fetch(`/api/returns/${item.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmProtocol: confirmation }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir a devolução.');
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      setNotice(`${item.protocol} excluída permanentemente.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir a devolução.');
    } finally { setDeletingId(''); }
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
            <Button variant="outline" size="lg" className="hidden h-11 rounded-xl px-4 sm:inline-flex" disabled={viewMode === 'finalized' || !firstPending} onClick={() => firstPending && setDetailId(firstPending.id)}><ClipboardCheck /> Completar cadastro</Button>
            <Button size="lg" className="h-11 rounded-xl px-4 shadow-[0_8px_20px_rgb(13_96_83/18%)]" onClick={() => { window.location.href = '/receber'; }}><Camera /><span className="hidden sm:inline">Registrar recebimento</span><span className="sm:hidden">Registrar</span></Button>
          </div>
        </div>
        <nav aria-label="Navegação principal" className="mx-auto hidden max-w-[1500px] items-center gap-2 border-t border-border/70 px-4 py-2 lg:flex lg:px-7">
          <HeaderNav active={viewMode === 'pending'} icon={<LayoutDashboard />} label="Pendências" onClick={() => changeView('pending')} />
          <HeaderNav active={viewMode === 'finalized'} icon={<Archive />} label="Finalizadas" onClick={() => changeView('finalized')} />
          <HeaderNav icon={<Store />} label="Filtrar por loja" onClick={() => (document.querySelector('select[aria-label="Filtrar por loja"]') as { focus?: () => void } | null)?.focus?.()} />
          <HeaderNav icon={<Settings />} label="Configurações" onClick={() => { window.location.href = '/configuracoes'; }} />
          <p className="ml-auto text-xs text-muted-foreground">{viewMode === 'finalized' ? 'Histórico concluído e limpeza de armazenamento' : 'Fila operacional em andamento'}</p>
        </nav>
      </header>

      <main className="mx-auto min-w-0 max-w-[1500px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-sm font-semibold text-primary">{viewMode === 'finalized' ? 'Arquivo concluído' : todayLabel()}</p><h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] sm:text-[28px]">{viewMode === 'finalized' ? 'Devoluções finalizadas' : 'Fila de devoluções'}</h1><p className="mt-1 text-sm text-muted-foreground">{viewMode === 'finalized' ? 'Consulte registros concluídos ou exclua manualmente o que não precisa mais ser guardado.' : 'Comece pelas devoluções que precisam de ação.'}</p></div>
              <div className="relative md:hidden"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 rounded-xl bg-card pl-9" placeholder="Buscar devolução" aria-label="Buscar devolução" /></div>
            </div>

            {viewMode === 'pending' && <section aria-label="Resumo das pendências" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Metric icon={<Camera />} label="Novas por foto" value={metrics.pending} accent="bg-amber-100 text-amber-800" active={statusFilters.includes('PENDING_INFO')} onClick={() => toggleStatusFilter('PENDING_INFO')} />
              <Metric icon={<TestTube2 />} label="Aguardando teste" value={metrics.testing} accent="bg-sky-100 text-sky-800" active={statusFilters.includes('WAITING_TEST')} onClick={() => toggleStatusFilter('WAITING_TEST')} />
              <Metric icon={<FileText />} label="Aguardando nota" value={metrics.entry} accent="bg-violet-100 text-violet-800" active={statusFilters.includes('WAITING_ENTRY')} onClick={() => toggleStatusFilter('WAITING_ENTRY')} />
              <Metric icon={<CheckCircle2 />} label="Prontas para finalizar" value={metrics.ready} accent="bg-emerald-100 text-emerald-800" active={statusFilters.includes('READY')} onClick={() => toggleStatusFilter('READY')} extraClass="col-span-2 xl:col-span-1" />
            </section>}

            <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-start">
              {viewMode === 'pending' && statuses.length > 0 && (
                <StatusMultiSelect
                  statuses={statuses.filter((status) => status.code !== 'FINALIZED')}
                  selected={statusFilters}
                  onChange={setStatusFilters}
                />
              )}
              <NativeSelect aria-label="Filtrar por loja" className="h-11 w-full lg:w-60" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
                <NativeSelectOption value="">Todas as lojas</NativeSelectOption>
                {storeOptions.map((store) => <NativeSelectOption key={store} value={store}>{store}</NativeSelectOption>)}
              </NativeSelect>
            </div>

            {viewMode === 'pending' && statusFilters.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Status selecionados">
                {statuses.filter((status) => statusFilters.includes(status.code)).map((status) => (
                  <button
                    key={status.code}
                    type="button"
                    className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition hover:opacity-75 ${statusClass(status.color)}`}
                    style={statusStyle(status.color)}
                    onClick={() => toggleStatusFilter(status.code)}
                    aria-label={`Remover filtro ${status.label}`}
                  >
                    <span className="size-2 rounded-full" style={statusDotStyle(status.color)} />
                    {status.label}
                    <X className="size-3" />
                  </button>
                ))}
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setStatusFilters([])}>Limpar status</Button>
              </div>
            )}

            <section className="mt-7">
              <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-bold tracking-tight">{viewMode === 'finalized' ? 'Histórico finalizado' : statusFilters.length === 1 ? statuses.find((status) => status.code === statusFilters[0])?.label || 'Resultados' : statusFilters.length > 1 ? `${statusFilters.length} status selecionados` : search ? 'Resultados da busca' : storeFilter ? `Loja: ${storeFilter}` : 'Prioridade agora'}</h2><p className="text-xs text-muted-foreground">{visibleItems.length} {visibleItems.length === 1 ? 'devolução encontrada' : 'devoluções encontradas'}</p></div>{(statusFilters.length > 0 || storeFilter || search) && <Button variant="ghost" className="text-primary" onClick={() => { setStatusFilters([]); setStoreFilter(''); setSearch(''); }}>Limpar filtros <X /></Button>}</div>

              {error ? (
                <Alert variant="destructive"><X /><AlertTitle>Não foi possível carregar</AlertTitle><AlertDescription>{error} <button className="font-semibold underline" onClick={() => loadReturns()}>Tentar novamente</button></AlertDescription></Alert>
              ) : loading ? (
                <div className="grid min-h-56 place-items-center text-muted-foreground"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin" /><p className="mt-2 text-sm">Atualizando a fila...</p></div></div>
              ) : visibleItems.length === 0 ? (
                <EmptyState finalized={viewMode === 'finalized'} hasFilters={Boolean(search || statusFilters.length > 0 || storeFilter)} onCreate={() => { window.location.href = '/receber'; }} onClear={() => { setSearch(''); setStatusFilters([]); setStoreFilter(''); }} />
              ) : (
                <div className="grid gap-3 xl:grid-cols-3">
                  {visibleItems.map((item) => <ReturnCard key={item.id} item={item} deleting={deletingId === item.id} onOpen={() => setDetailId(item.id)} onDelete={viewMode === 'finalized' ? () => void deleteReturn(item) : undefined} />)}
                </div>
              )}
            </section>
          </div>
      </main>

      <nav aria-label="Navegação móvel" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-2xl border border-border/80 bg-card/95 px-1 py-2 shadow-[0_14px_50px_rgb(25_35_32/18%)] backdrop-blur-xl lg:hidden">
        <MobileNav icon={<LayoutDashboard />} label="Pendentes" active={viewMode === 'pending'} onClick={() => changeView('pending')} />
        <MobileNav icon={<Archive />} label="Finalizadas" active={viewMode === 'finalized'} onClick={() => changeView('finalized')} />
        <MobileNav icon={<Camera />} label="Nova" onClick={() => { window.location.href = '/receber'; }} />
        <MobileNav icon={<Search />} label="Buscar" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Buscar devolução"]')?.focus()} />
        <MobileNav icon={<Settings />} label="Ajustes" onClick={() => { window.location.href = '/configuracoes'; }} />
      </nav>

      <Dialog open={Boolean(detailId)} onOpenChange={(open) => {
        if (!open) {
          setDetailId(null);
          void loadReturns(search, viewMode);
        }
      }}>
        <DialogContent showCloseButton={false} className="h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1500px] sm:rounded-3xl">
          <DialogTitle className="sr-only">Gerenciar devolução</DialogTitle>
          {detailId && <ReturnWorkspace returnId={detailId} embedded onClose={() => {
            setDetailId(null);
            void loadReturns(search, viewMode);
          }} />}
        </DialogContent>
      </Dialog>

      {notice && <output className="fixed bottom-24 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl lg:bottom-5">{notice}</output>}

    </div>
  );
}

function StatusMultiSelect({ statuses, selected, onChange }: { statuses: StatusDefinition[]; selected: string[]; onChange: (selected: string[]) => void }) {
  const selectedStatuses = statuses.filter((status) => selected.includes(status.code));
  const summary = selectedStatuses.length === 0
    ? 'Todos os status em andamento'
    : selectedStatuses.length === 1
      ? selectedStatuses[0].label
      : `${selectedStatuses.length} status selecionados`;

  function toggle(code: string) {
    onChange(selected.includes(code) ? selected.filter((statusCode) => statusCode !== code) : [...selected, code]);
  }

  return (
    <div className="w-full lg:w-[22rem]">
      <Popover>
        <PopoverTrigger
          type="button"
          className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 text-left text-sm font-medium outline-none transition hover:bg-muted/45 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`Filtrar por status. ${summary}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ListFilter className="size-4 shrink-0 text-muted-foreground" />
            {selectedStatuses.length > 0 && (
              <span className="flex shrink-0 -space-x-1" aria-hidden="true">
                {selectedStatuses.slice(0, 4).map((status) => (
                  <span key={status.code} className="size-3 rounded-full ring-2 ring-background" style={statusDotStyle(status.color)} />
                ))}
              </span>
            )}
            <span className="truncate">{summary}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-2 p-2.5">
          <PopoverHeader className="flex-row items-start justify-between gap-3 px-1 pt-1">
            <div>
              <PopoverTitle className="font-bold">Filtrar por status</PopoverTitle>
              <PopoverDescription className="mt-0.5 text-xs">Marque um ou vários status.</PopoverDescription>
            </div>
            {selected.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs text-primary" onClick={() => onChange([])}>Limpar</Button>
            )}
          </PopoverHeader>
          <fieldset className="max-h-72 space-y-1 overflow-y-auto pr-1">
            <legend className="sr-only">Status disponíveis</legend>
            {statuses.map((status) => {
              const isSelected = selected.includes(status.code);
              return (
                <label key={status.code} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${isSelected ? 'border-primary/25 bg-primary/6' : 'border-transparent hover:bg-muted/60'}`}>
                  <Checkbox checked={isSelected} onCheckedChange={() => toggle(status.code)} />
                  <span className="size-3 shrink-0 rounded-full ring-4 ring-background" style={statusDotStyle(status.color)} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{status.label}</span>
                </label>
              );
            })}
          </fieldset>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ReturnCard({ item, deleting, onOpen, onDelete }: { item: ReturnSummary; deleting: boolean; onOpen: () => void; onDelete?: () => void }) {
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
          <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="font-bold">{item.protocol}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.store || 'Loja ainda não informada'}</p></div><Badge variant="outline" className={statusClass(item.status_color)} style={statusStyle(item.status_color)}><span className="size-2 rounded-full" style={statusDotStyle(item.status_color)} />{item.status_label}</Badge></div></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">Identificação</p><p className="mt-1 truncate font-semibold">{item.tracking_code || item.order_id || 'Dados pendentes'}</p></div><div><p className="text-muted-foreground">Itens e fotos</p><p className="mt-1 font-semibold">{item.item_count} {item.item_count === 1 ? 'item' : 'itens'} · {item.photo_count} {item.photo_count === 1 ? 'foto' : 'fotos'}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t pt-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> {item.finalized_at ? `Finalizada em ${shortDate(item.finalized_at)}` : relativeDate(item.received_at)}</p><span className="flex items-center gap-1 text-xs font-semibold text-primary">Abrir <ArrowRight className="size-3.5" /></span></div>
      </button>
      {onDelete && <div className="border-t px-3 py-2"><Button type="button" variant="ghost" size="sm" className="w-full text-destructive hover:bg-destructive/8 hover:text-destructive" disabled={deleting} onClick={onDelete}>{deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir definitivamente</Button></div>}
    </Card>
  );
}

function Metric({ icon, label, value, accent, active, onClick, extraClass = '' }: { icon: React.ReactNode; label: string; value: number; accent: string; active: boolean; onClick: () => void; extraClass?: string }) {
  return <Card className={`border-0 bg-card py-0 shadow-[0_8px_26px_rgb(28_39_36/5%)] ring-border/80 ${active ? 'ring-2 ring-primary' : ''} ${extraClass}`}><button type="button" className="flex w-full items-center gap-3 p-3 text-left sm:p-4" onClick={onClick}><span className={`grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-[18px] ${accent}`}>{icon}</span><div className="min-w-0"><p className="text-xl font-extrabold leading-none tracking-tight">{value}</p><p className="mt-1 truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p></div></button></Card>;
}

function HeaderNav({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold [&>svg]:size-[18px] ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{icon}{label}</button>;
}

function MobileNav({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold [&>svg]:size-[19px] ${active ? 'bg-primary/9 text-primary' : 'text-muted-foreground'}`} onClick={onClick}>{icon}{label}</button>;
}

function EmptyState({ finalized, hasFilters, onCreate, onClear }: { finalized: boolean; hasFilters: boolean; onCreate: () => void; onClear: () => void }) {
  return <div className="rounded-3xl border border-dashed bg-card/60 px-6 py-14 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">{finalized ? <Archive className="size-7" /> : <Inbox className="size-7" />}</div><h3 className="mt-4 text-lg font-bold">{hasFilters ? 'Nenhuma devolução encontrada' : finalized ? 'Nenhuma devolução finalizada' : 'A fila está vazia'}</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{hasFilters ? 'Tente remover os filtros ou buscar por outro termo.' : finalized ? 'Quando uma devolução for concluída, ela aparecerá aqui.' : 'Registre o primeiro recebimento por foto ou preencha o cadastro completo.'}</p><div className="mt-5 flex justify-center gap-2">{hasFilters && <Button variant="outline" className="h-11" onClick={onClear}>Limpar filtros</Button>}{!finalized && <Button className="h-11" onClick={onCreate}><Camera /> Registrar recebimento</Button>}</div></div>;
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

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

function todayLabel() {
  const text = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return text.charAt(0).toUpperCase() + text.slice(1);
}
