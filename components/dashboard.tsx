'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Archive,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Grid2X2,
  Inbox,
  LayoutDashboard,
  List,
  ListFilter,
  Loader2,
  PackageCheck,
  Search,
  Settings,
  Store,
  TestTube2,
  Trash2,
  Video,
  X,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ReturnWorkspace } from '@/components/return-workspace';
import { UserMenu } from '@/components/user-menu';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth';
import { hasAnyUserPermission, hasUserPermission, SETTINGS_PERMISSIONS } from '@/lib/permissions';
import type { ConfigOption, ConfigOptionsResponse, ReturnSummary, StatusDefinition } from '@/lib/returns';
import { statusClass, statusDotStyle, statusStyle } from '@/lib/status-colors';

export function Dashboard({ currentUser }: { currentUser: AuthUser }) {
  const canCreateReturns = hasUserPermission(currentUser, 'returns.create');
  const canDeleteReturns = hasUserPermission(currentUser, 'returns.delete');
  const canOpenSettings = hasAnyUserPermission(currentUser, SETTINGS_PERMISSIONS);
  const mobileNavColumns = canCreateReturns && canOpenSettings ? 'grid-cols-5' : canCreateReturns || canOpenSettings ? 'grid-cols-4' : 'grid-cols-3';
  const [items, setItems] = useState<ReturnSummary[]>([]);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [storeFilters, setStoreFilters] = useState<string[]>([]);
  const [configuredStores, setConfiguredStores] = useState<ConfigOption[]>([]);
  const [viewMode, setViewMode] = useState<'pending' | 'finalized'>('pending');
  const [listLayout, setListLayout] = useState<'grid' | 'list'>('grid');
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
      const response = await apiFetch(`/api/returns?${params}`);
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
      apiFetch('/api/config/statuses?includeInactive=true').then(async (response) => ({ response, result: (await response.json()) as { items?: StatusDefinition[] } })),
      apiFetch('/api/config/options').then(async (response) => ({ response, result: (await response.json()) as ConfigOptionsResponse })),
    ])
      .then(([statusResponse, optionResponse]) => {
        if (cancelled) return;
        if (statusResponse.response.ok) setStatuses(statusResponse.result.items || []);
        if (optionResponse.response.ok) setConfiguredStores(optionResponse.result.stores);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadReturns(search, viewMode), 250);
    return () => window.clearTimeout(timer);
  }, [loadReturns, search, viewMode]);
  useEffect(() => {
    const savedLayout = window.localStorage.getItem('returns-list-layout');
    const timer = window.setTimeout(() => {
      if (savedLayout === 'grid' || savedLayout === 'list') setListLayout(savedLayout);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); }, [notice]);
  const visibleItems = useMemo(
    () => items.filter((item) => (statusFilters.length === 0 || statusFilters.includes(item.status)) && (storeFilters.length === 0 || Boolean(item.store && storeFilters.includes(item.store)))),
    [items, statusFilters, storeFilters],
  );
  const storeOptions = useMemo(() => {
    const storesByLabel = new Map(configuredStores.map((store) => [store.label, store]));
    for (const item of items) {
      if (item.store && !storesByLabel.has(item.store)) {
        storesByLabel.set(item.store, { code: `HISTORICAL_${item.store}`, type: 'STORE', label: item.store, color: item.store_color || '#64748b', is_system: 0, sort_order: 999, active: 1, requires_invoice: 1, requires_notes: 0 });
      }
    }
    return [...storesByLabel.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [configuredStores, items]);
  const metrics = useMemo(() => ({
    pending: items.filter((item) => item.status === 'PENDING_INFO').length,
    testing: items.filter((item) => item.status === 'WAITING_TEST').length,
    entry: items.filter((item) => item.status === 'WAITING_ENTRY').length,
    ready: items.filter((item) => item.status === 'READY').length,
  }), [items]);

  function changeView(nextView: 'pending' | 'finalized') {
    setViewMode(nextView);
    setStatusFilters([]);
    setStoreFilters([]);
  }

  function changeListLayout(nextLayout: 'grid' | 'list') {
    setListLayout(nextLayout);
    window.localStorage.setItem('returns-list-layout', nextLayout);
  }

  function toggleStatusFilter(code: string) {
    setStatusFilters((current) => current.includes(code) ? current.filter((statusCode) => statusCode !== code) : [...current, code]);
  }

  function toggleStoreFilter(label: string) {
    setStoreFilters((current) => current.includes(label) ? current.filter((storeLabel) => storeLabel !== label) : [...current, label]);
  }

  async function deleteReturn(item: ReturnSummary) {
    if (!canDeleteReturns) return;
    const confirmation = window.prompt(`Para excluir definitivamente ${item.protocol}, digite o protocolo abaixo:`);
    if (confirmation !== item.protocol) return;
    setDeletingId(item.id);
    setError('');
    try {
      const response = await apiFetch(`/api/returns/${item.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmProtocol: confirmation }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir a devolução.');
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      setNotice(`${item.protocol} excluída permanentemente.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir a devolução.');
    } finally { setDeletingId(''); }
  }

  return (
    <div className="app-shell min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/75 bg-background/88 shadow-[0_1px_0_rgb(255_255_255/45%)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <div className="flex min-w-fit items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-[0_8px_20px_rgb(13_96_83/20%)]"><PackageCheck className="size-5" /></div>
            <div><p className="text-[15px] font-semibold leading-none tracking-[-0.02em]">Retorno</p><p className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Gestão de devoluções</p></div>
          </div>

          <div className="relative mx-auto hidden w-full max-w-xl md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 rounded-xl bg-card pl-9 pr-10 shadow-xs" placeholder="Buscar rastreio, pedido, protocolo, produto ou nota" aria-label="Buscar devoluções" />
            {search && <button type="button" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted" onClick={() => setSearch('')} aria-label="Limpar busca"><X className="size-4" /></button>}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {canCreateReturns && <Button size="lg" className="h-11 rounded-xl px-4 shadow-[0_8px_20px_rgb(13_96_83/18%)]" onClick={() => { window.location.href = '/receber'; }}><Camera /><span className="hidden sm:inline">Registrar recebimento</span><span className="sm:hidden">Registrar</span></Button>}
            <UserMenu user={currentUser} />
          </div>
        </div>
        <nav aria-label="Navegação principal" className="mx-auto hidden max-w-7xl items-center gap-2 border-t border-border/60 px-4 py-2 sm:px-6 lg:flex">
          <HeaderNav active={viewMode === 'pending'} icon={<LayoutDashboard />} label="Pendências" onClick={() => changeView('pending')} />
          <HeaderNav active={viewMode === 'finalized'} icon={<Archive />} label="Finalizadas" onClick={() => changeView('finalized')} />
          <HeaderNav icon={<Store />} label="Filtrar por loja" onClick={() => document.querySelector<HTMLButtonElement>('button[aria-label^="Filtrar por loja"]')?.focus()} />
          {canOpenSettings && <HeaderNav icon={<Settings />} label="Configurações" onClick={() => { window.location.href = '/configuracoes'; }} />}
          <p className="ml-auto text-xs text-muted-foreground">{viewMode === 'finalized' ? 'Histórico concluído e limpeza de armazenamento' : 'Fila operacional em andamento'}</p>
        </nav>
      </header>

      <main className="mx-auto min-w-0 max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-10 lg:pt-8">
          <div className="mx-auto">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-sm font-semibold text-primary">{viewMode === 'finalized' ? 'Arquivo concluído' : todayLabel()}</p><h1 className="display-title mt-1 text-2xl sm:text-[30px]">{viewMode === 'finalized' ? 'Devoluções finalizadas' : 'Fila de devoluções'}</h1><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{viewMode === 'finalized' ? 'Consulte registros concluídos ou exclua manualmente o que não precisa mais ser guardado.' : 'Comece pelas devoluções que precisam de ação.'}</p></div>
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
                  statuses={statuses.filter((status) => status.code !== 'FINALIZED' && (Boolean(status.active) || Number(status.usage_count || 0) > 0))}
                  selected={statusFilters}
                  onChange={setStatusFilters}
                />
              )}
              {storeOptions.length > 0 && <StoreMultiSelect stores={storeOptions} selected={storeFilters} onChange={setStoreFilters} />}
            </div>

            {(statusFilters.length > 0 || storeFilters.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Filtros selecionados">
                {viewMode === 'pending' && statuses.filter((status) => statusFilters.includes(status.code)).map((status) => (
                  <button
                    key={status.code}
                    type="button"
                    className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition hover:opacity-75 ${statusClass(status.color)}`}
                    style={statusStyle(status.color)}
                    onClick={() => toggleStatusFilter(status.code)}
                    aria-label={`Remover filtro ${status.label}`}
                  >
                    <span className="size-2 rounded-full" style={statusDotStyle(status.color)} />
                    {status.label}{status.active ? '' : ' · inativo'}
                    <X className="size-3" />
                  </button>
                ))}
                {storeOptions.filter((store) => storeFilters.includes(store.label)).map((store) => (
                  <button
                    key={store.code}
                    type="button"
                    className="inline-flex min-h-8 items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-foreground transition hover:opacity-75"
                    style={{ borderColor: `${store.color}55`, backgroundColor: `${store.color}10` }}
                    onClick={() => toggleStoreFilter(store.label)}
                    aria-label={`Remover filtro da loja ${store.label}`}
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: store.color }} />
                    {store.label}
                    <X className="size-3" />
                  </button>
                ))}
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setStatusFilters([]); setStoreFilters([]); }}>Limpar seleções</Button>
              </div>
            )}

            <section className="mt-7">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-semibold tracking-tight">{viewMode === 'finalized' ? 'Histórico finalizado' : search ? 'Resultados da busca' : statusFilters.length > 0 || storeFilters.length > 0 ? 'Resultados filtrados' : 'Prioridade agora'}</h2><p className="text-xs text-muted-foreground">{visibleItems.length} {visibleItems.length === 1 ? 'devolução encontrada' : 'devoluções encontradas'}</p></div><div className="flex flex-wrap items-center gap-2"><fieldset className="inline-flex rounded-xl border bg-card p-1 shadow-xs"><legend className="sr-only">Formato de exibição</legend><button type="button" className={`flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${listLayout === 'grid' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-pressed={listLayout === 'grid'} onClick={() => changeListLayout('grid')}><Grid2X2 className="size-3.5" /> Grade</button><button type="button" className={`flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${listLayout === 'list' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-pressed={listLayout === 'list'} onClick={() => changeListLayout('list')}><List className="size-3.5" /> Lista</button></fieldset>{(statusFilters.length > 0 || storeFilters.length > 0 || search) && <Button variant="ghost" className="h-11 text-primary" onClick={() => { setStatusFilters([]); setStoreFilters([]); setSearch(''); }}>Limpar filtros <X /></Button>}</div></div>

              {error ? (
                <Alert variant="destructive"><X /><AlertTitle>Não foi possível carregar</AlertTitle><AlertDescription>{error} <button className="font-semibold underline" onClick={() => loadReturns()}>Tentar novamente</button></AlertDescription></Alert>
              ) : loading ? (
                <div className="grid min-h-56 place-items-center text-muted-foreground"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin" /><p className="mt-2 text-sm">Atualizando a fila...</p></div></div>
              ) : visibleItems.length === 0 ? (
                <EmptyState finalized={viewMode === 'finalized'} hasFilters={Boolean(search || statusFilters.length > 0 || storeFilters.length > 0)} canCreate={canCreateReturns} onCreate={() => { window.location.href = '/receber'; }} onClear={() => { setSearch(''); setStatusFilters([]); setStoreFilters([]); }} />
              ) : (
                <div className={listLayout === 'grid' ? 'grid gap-3 xl:grid-cols-3' : 'space-y-2'}>
                  {visibleItems.map((item) => listLayout === 'grid'
                    ? <ReturnCard key={item.id} item={item} deleting={deletingId === item.id} onOpen={() => setDetailId(item.id)} onDelete={viewMode === 'finalized' && canDeleteReturns ? () => void deleteReturn(item) : undefined} />
                    : <ReturnListRow key={item.id} item={item} deleting={deletingId === item.id} onOpen={() => setDetailId(item.id)} onDelete={viewMode === 'finalized' && canDeleteReturns ? () => void deleteReturn(item) : undefined} />)}
                </div>
              )}
            </section>
          </div>
      </main>

      <nav aria-label="Navegação móvel" className={`fixed inset-x-3 bottom-3 z-40 grid ${mobileNavColumns} rounded-2xl border border-border/80 bg-card/95 px-1 py-2 shadow-[var(--shadow-floating)] backdrop-blur-xl lg:hidden`}>
        <MobileNav icon={<LayoutDashboard />} label="Pendentes" active={viewMode === 'pending'} onClick={() => changeView('pending')} />
        <MobileNav icon={<Archive />} label="Finalizadas" active={viewMode === 'finalized'} onClick={() => changeView('finalized')} />
        {canCreateReturns && <MobileNav icon={<Camera />} label="Nova" onClick={() => { window.location.href = '/receber'; }} />}
        <MobileNav icon={<Search />} label="Buscar" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Buscar devolução"]')?.focus()} />
        {canOpenSettings && <MobileNav icon={<Settings />} label="Ajustes" onClick={() => { window.location.href = '/configuracoes'; }} />}
      </nav>

      <Dialog open={Boolean(detailId)} onOpenChange={(open) => {
        if (!open) {
          setDetailId(null);
          void loadReturns(search, viewMode);
        }
      }}>
        <DialogContent showCloseButton={false} className="h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1500px] sm:rounded-3xl">
          <DialogTitle className="sr-only">Gerenciar devolução</DialogTitle>
          {detailId && <ReturnWorkspace returnId={detailId} currentUser={currentUser} embedded onClose={() => {
            setDetailId(null);
            void loadReturns(search, viewMode);
          }} />}
        </DialogContent>
      </Dialog>

      {notice && <output className="fixed bottom-24 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl lg:bottom-5">{notice}</output>}

    </div>
  );
}

type ColorFilterOption = { value: string; label: string; color: string };

function StatusMultiSelect({ statuses, selected, onChange }: { statuses: StatusDefinition[]; selected: string[]; onChange: (selected: string[]) => void }) {
  return <ColorMultiSelect icon={<ListFilter />} title="Filtrar por status" description="Marque um ou vários status." allLabel="Todos os status em andamento" plural="status selecionados" options={statuses.map((status) => ({ value: status.code, label: status.active ? status.label : `${status.label} · inativo`, color: status.color }))} selected={selected} onChange={onChange} />;
}

function StoreMultiSelect({ stores, selected, onChange }: { stores: ConfigOption[]; selected: string[]; onChange: (selected: string[]) => void }) {
  return <ColorMultiSelect icon={<Store />} title="Filtrar por loja" description="Marque uma ou várias lojas." allLabel="Todas as lojas" plural="lojas selecionadas" searchable options={stores.map((store) => ({ value: store.label, label: store.label, color: store.color }))} selected={selected} onChange={onChange} />;
}

function ColorMultiSelect({ icon, title, description, allLabel, plural, searchable = false, options, selected, onChange }: { icon: React.ReactNode; title: string; description: string; allLabel: string; plural: string; searchable?: boolean; options: ColorFilterOption[]; selected: string[]; onChange: (selected: string[]) => void }) {
  const [query, setQuery] = useState('');
  const selectedOptions = options.filter((option) => selected.includes(option.value));
  const visibleOptions = query.trim()
    ? options.filter((option) => option.label.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))
    : options;
  const summary = selectedOptions.length === 0 ? allLabel : selectedOptions.length === 1 ? selectedOptions[0].label : `${selectedOptions.length} ${plural}`;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((selectedValue) => selectedValue !== value) : [...selected, value]);
  }

  return <div className="w-full lg:w-[22rem]"><Popover><PopoverTrigger type="button" className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-input bg-card px-3 text-left text-sm font-medium shadow-xs outline-none transition hover:border-primary/25 hover:bg-card focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`${title}. ${summary}`}><span className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-muted-foreground [&>svg]:size-4">{icon}</span>{selectedOptions.length > 0 && <span className="flex shrink-0 -space-x-1" aria-hidden="true">{selectedOptions.slice(0, 4).map((option) => <span key={option.value} className="size-3 rounded-full ring-2 ring-background" style={statusDotStyle(option.color)} />)}</span>}<span className="truncate">{summary}</span></span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></PopoverTrigger><PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-2 p-2.5"><PopoverHeader className="flex-row items-start justify-between gap-3 px-1 pt-1"><div><PopoverTitle className="font-semibold">{title}</PopoverTitle><PopoverDescription className="mt-0.5 text-xs">{description}</PopoverDescription></div>{selected.length > 0 && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs text-primary" onClick={() => onChange([])}>Limpar</Button>}</PopoverHeader>{searchable && options.length > 8 && <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 rounded-xl pl-9" placeholder="Buscar loja" aria-label="Buscar loja no filtro" /></div>}<fieldset className="max-h-72 space-y-1 overflow-y-auto pr-1"><legend className="sr-only">Opções disponíveis</legend>{visibleOptions.map((option) => { const isSelected = selected.includes(option.value); return <label key={option.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${isSelected ? 'border-primary/25 bg-primary/6' : 'border-transparent hover:bg-muted/60'}`}><Checkbox checked={isSelected} onCheckedChange={() => toggle(option.value)} /><span className="size-3 shrink-0 rounded-full ring-4 ring-background" style={statusDotStyle(option.color)} aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span></label>; })}{visibleOptions.length === 0 && <p className="px-3 py-5 text-center text-sm text-muted-foreground">Nenhuma loja encontrada.</p>}</fieldset></PopoverContent></Popover></div>;
}

function ReturnCard({ item, deleting, onOpen, onDelete }: { item: ReturnSummary; deleting: boolean; onOpen: () => void; onDelete?: () => void }) {
  return (
    <Card className="border-0 bg-card py-0 shadow-[var(--shadow-card)] ring-border/80 transition-shadow duration-200 hover:shadow-[var(--shadow-raised)] motion-reduce:transition-none">
      <button type="button" aria-label={returnAccessibleLabel(item)} className="w-full p-4 text-left" onClick={onOpen}>
        <div className="flex items-start gap-3">
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
            {item.first_photo_id ? (
              // Dynamic private photos are intentionally served without public image optimization.
              // eslint-disable-next-line next/no-img-element
              <img src={`/api/photos/${item.first_photo_id}`} alt="" className="h-full w-full object-cover" />
            ) : item.video_count > 0 ? <Video className="size-5" /> : <Box className="size-5" />}
          </div>
          <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold tabular-nums tracking-tight">{item.protocol}</p><p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">{item.store && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.store_color || '#64748b' }} aria-hidden="true" />}{item.store || 'Loja ainda não informada'}</p></div><Badge variant="outline" className={statusClass(item.status_color)} style={statusStyle(item.status_color)}><span className="size-2 rounded-full" style={statusDotStyle(item.status_color)} />{item.status_label}</Badge></div></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">Identificação</p><p className="mt-1 truncate font-semibold">{item.tracking_code || item.order_id || 'Dados pendentes'}</p></div><div><p className="text-muted-foreground">Itens e arquivos</p><p className="mt-1 font-semibold">{mediaSummary(item)}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t pt-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> {item.finalized_at ? `Finalizada em ${shortDate(item.finalized_at)}` : relativeDate(item.received_at)}</p><span className="flex items-center gap-1 text-xs font-semibold text-primary">Abrir <ArrowRight className="size-3.5" /></span></div>
      </button>
      {onDelete && <div className="border-t px-3 py-2"><Button type="button" variant="ghost" size="sm" className="w-full text-destructive hover:bg-destructive/8 hover:text-destructive" disabled={deleting} onClick={onDelete}>{deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir definitivamente</Button></div>}
    </Card>
  );
}

function ReturnListRow({ item, deleting, onOpen, onDelete }: { item: ReturnSummary; deleting: boolean; onOpen: () => void; onDelete?: () => void }) {
  return (
    <Card className="border-0 bg-card py-0 shadow-[var(--shadow-card)] ring-border/80 transition-shadow duration-200 hover:shadow-[var(--shadow-raised)] motion-reduce:transition-none">
      <button type="button" aria-label={returnAccessibleLabel(item)} className="flex w-full items-center gap-3 p-3 text-left sm:p-4" onClick={onOpen}>
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
          {item.first_photo_id ? (
            // Dynamic private photos are intentionally served without public image optimization.
            // eslint-disable-next-line next/no-img-element
            <img src={`/api/photos/${item.first_photo_id}`} alt="" className="h-full w-full object-cover" />
          ) : item.video_count > 0 ? <Video className="size-5" /> : <Box className="size-5" />}
        </div>
        <div className="min-w-0 flex-1 sm:max-w-[18rem]">
          <p className="font-semibold tabular-nums tracking-tight">{item.protocol}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">{item.store && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.store_color || '#64748b' }} aria-hidden="true" />}{item.store || 'Loja ainda não informada'}</p>
          <p className="mt-1 truncate text-[11px] font-medium text-muted-foreground sm:hidden">{item.tracking_code || item.order_id || 'Dados pendentes'} · {mediaSummary(item)}</p>
        </div>
        <div className="hidden min-w-0 flex-1 sm:block">
          <p className="text-[11px] text-muted-foreground">Rastreio ou pedido</p>
          <p className="mt-1 truncate text-xs font-semibold">{item.tracking_code || item.order_id || 'Dados pendentes'}</p>
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="text-[11px] text-muted-foreground">Itens e arquivos</p>
          <p className="mt-1 truncate text-xs font-semibold">{mediaSummary(item)}</p>
        </div>
        <p className="hidden min-w-[8rem] items-center gap-1.5 text-xs text-muted-foreground lg:flex"><Clock3 className="size-3.5" /> {item.finalized_at ? shortDate(item.finalized_at) : relativeDate(item.received_at)}</p>
        <Badge variant="outline" className={statusClass(item.status_color)} style={statusStyle(item.status_color)}><span className="size-2 rounded-full" style={statusDotStyle(item.status_color)} /><span className="max-w-24 truncate sm:max-w-40">{item.status_label}</span></Badge>
        <ArrowRight className="size-4 shrink-0 text-primary" />
      </button>
      {onDelete && <div className="flex justify-end border-t px-3 py-2"><Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/8 hover:text-destructive" disabled={deleting} onClick={onDelete}>{deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir definitivamente</Button></div>}
    </Card>
  );
}

function mediaSummary(item: ReturnSummary) {
  const itemLabel = `${item.item_count} ${item.item_count === 1 ? 'item' : 'itens'}`;
  const photoLabel = `${item.photo_count} ${item.photo_count === 1 ? 'foto' : 'fotos'}`;
  const videoLabel = `${item.video_count} ${item.video_count === 1 ? 'vídeo' : 'vídeos'}`;
  return `${itemLabel} · ${photoLabel} · ${videoLabel}`;
}

function returnAccessibleLabel(item: ReturnSummary) {
  const store = item.store || 'loja ainda não informada';
  const identifier = item.tracking_code || item.order_id || 'identificação pendente';
  return `Abrir ${item.protocol}. ${store}. Status ${item.status_label}. ${identifier}. ${mediaSummary(item)}.`;
}

function Metric({ icon, label, value, accent, active, onClick, extraClass = '' }: { icon: React.ReactNode; label: string; value: number; accent: string; active: boolean; onClick: () => void; extraClass?: string }) {
  return <Card className={`border-0 bg-card py-0 shadow-[var(--shadow-card)] ring-border/80 transition-shadow ${active ? 'ring-2 ring-primary shadow-[var(--shadow-raised)]' : ''} ${extraClass}`}><button type="button" className="flex w-full items-center gap-3 p-3 text-left sm:p-4" onClick={onClick}><span className={`grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-[18px] ${accent}`}>{icon}</span><div className="min-w-0"><p className="text-xl font-bold leading-none tracking-tight tabular-nums">{value}</p><p className="mt-1 truncate text-xs font-medium text-muted-foreground">{label}</p></div></button></Card>;
}

function HeaderNav({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold [&>svg]:size-[18px] ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{icon}{label}</button>;
}

function MobileNav({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold [&>svg]:size-[19px] ${active ? 'bg-primary/9 text-primary' : 'text-muted-foreground'}`} onClick={onClick}>{icon}{label}</button>;
}

function EmptyState({ finalized, hasFilters, canCreate, onCreate, onClear }: { finalized: boolean; hasFilters: boolean; canCreate: boolean; onCreate: () => void; onClear: () => void }) {
  return <div className="rounded-3xl border border-dashed bg-card/60 px-6 py-14 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">{finalized ? <Archive className="size-7" /> : <Inbox className="size-7" />}</div><h3 className="mt-4 text-lg font-bold">{hasFilters ? 'Nenhuma devolução encontrada' : finalized ? 'Nenhuma devolução finalizada' : 'A fila está vazia'}</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{hasFilters ? 'Tente remover os filtros ou buscar por outro termo.' : finalized ? 'Quando uma devolução for concluída, ela aparecerá aqui.' : canCreate ? 'Registre o primeiro recebimento por foto ou preencha o cadastro completo.' : 'Nenhuma devolução está aguardando ação neste momento.'}</p><div className="mt-5 flex justify-center gap-2">{hasFilters && <Button variant="outline" className="h-11" onClick={onClear}>Limpar filtros</Button>}{!finalized && canCreate && <Button className="h-11" onClick={onCreate}><Camera /> Registrar recebimento</Button>}</div></div>;
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
