'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Image,
  Loader2,
  MapPin,
  PackageCheck,
  Plus,
  Settings2,
  Store,
  Tags,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { ConfigOption, ConfigOptionsResponse, StatusDefinition } from '@/lib/returns';
import { statusClass, statusDotStyle, statusStyle } from '@/lib/status-colors';

const emptyOptions: ConfigOptionsResponse = { locations: [], stores: [], conditions: [] };
type SettingsSection = 'status' | 'locais' | 'lojas' | 'condicoes' | 'regras' | 'fotos';

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('status');
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [options, setOptions] = useState<ConfigOptionsResponse>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusLabel, setStatusLabel] = useState('');
  const [statusColor, setStatusColor] = useState('#64748b');
  const [locationLabel, setLocationLabel] = useState('');
  const [storeLabel, setStoreLabel] = useState('');
  const [conditionLabel, setConditionLabel] = useState('');
  const [conditionColor, setConditionColor] = useState('#64748b');
  const [conditionRequiresInvoice, setConditionRequiresInvoice] = useState(true);
  const [conditionRequiresNotes, setConditionRequiresNotes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/config/statuses').then(async (response) => {
        const result = (await response.json()) as { items?: StatusDefinition[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os status.');
        return result.items || [];
      }),
      fetch('/api/config/options').then(async (response) => {
        const result = (await response.json()) as ConfigOptionsResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os cadastros.');
        return result;
      }),
    ])
      .then(([loadedStatuses, loadedOptions]) => {
        if (cancelled) return;
        setStatuses(loadedStatuses);
        setOptions(loadedOptions);
      })
      .catch((requestError) => !cancelled && setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as configurações.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function createStatus(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusLabel.trim()) return;
    setSaving('STATUS');
    setError('');
    try {
      const response = await fetch('/api/config/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: statusLabel, color: statusColor }),
      });
      const result = (await response.json()) as { item?: StatusDefinition; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível cadastrar o status.');
      setStatuses((current) => [...current, result.item as StatusDefinition]);
      setStatusLabel('');
      setNotice(`Status “${result.item.label}” cadastrado.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível cadastrar o status.');
    } finally {
      setSaving('');
    }
  }

  async function createOption(type: 'LOCATION' | 'STORE' | 'CONDITION') {
    const label = type === 'LOCATION' ? locationLabel : type === 'STORE' ? storeLabel : conditionLabel;
    if (!label.trim()) return;
    setSaving(type);
    setError('');
    try {
      const response = await fetch('/api/config/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          label,
          color: type === 'CONDITION' ? conditionColor : type === 'LOCATION' ? '#0f766e' : '#2563eb',
          requiresInvoice: conditionRequiresInvoice,
          requiresNotes: conditionRequiresNotes,
        }),
      });
      const result = (await response.json()) as { item?: ConfigOption; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível salvar o cadastro.');
      const key = type === 'LOCATION' ? 'locations' : type === 'STORE' ? 'stores' : 'conditions';
      setOptions((current) => ({ ...current, [key]: [...current[key], result.item as ConfigOption] }));
      if (type === 'LOCATION') setLocationLabel('');
      if (type === 'STORE') setStoreLabel('');
      if (type === 'CONDITION') {
        setConditionLabel('');
        setConditionRequiresInvoice(true);
        setConditionRequiresNotes(false);
      }
      setNotice(`${type === 'LOCATION' ? 'Local' : type === 'STORE' ? 'Loja' : 'Condição'} “${result.item.label}” cadastrado.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar o cadastro.');
    } finally {
      setSaving('');
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={() => window.location.assign('/')} className="grid size-11 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Voltar às devoluções"><ArrowLeft className="size-5" /></button>
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><PackageCheck className="size-5" /></div>
          <div><p className="text-base font-bold">Configurações</p><p className="text-xs text-muted-foreground">Cadastros e regras do sistema</p></div>
          <Button className="ml-auto hidden h-10 rounded-xl sm:inline-flex" onClick={() => { window.location.href = '/receber'; }}><Plus /> Nova devolução</Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[270px_minmax(0,1fr)] lg:gap-8 lg:py-10">
        <div className="lg:hidden">
          <Label htmlFor="settings-section" className="mb-2 block">Área de configuração</Label>
          <NativeSelect id="settings-section" className="w-full bg-card" value={activeSection} onChange={(event) => setActiveSection(event.target.value as SettingsSection)}>
            <NativeSelectOption value="status">Status e cores</NativeSelectOption>
            <NativeSelectOption value="locais">Locais de recebimento</NativeSelectOption>
            <NativeSelectOption value="lojas">Lojas de origem</NativeSelectOption>
            <NativeSelectOption value="condicoes">Condições do produto</NativeSelectOption>
            <NativeSelectOption value="regras">Regras de finalização</NativeSelectOption>
            <NativeSelectOption value="fotos">Fotos e envio</NativeSelectOption>
          </NativeSelect>
        </div>

        <aside className="hidden lg:block">
          <nav aria-label="Seções de configurações" className="sticky top-24 grid gap-2 rounded-3xl border bg-card p-3 shadow-[0_12px_38px_rgb(28_39_36/6%)]">
            <div className="px-3 pb-2 pt-1"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Configurar</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Escolha uma área para editar.</p></div>
            <SettingsNavButton active={activeSection === 'status'} onClick={() => setActiveSection('status')} icon={<Tags />} label="Status e cores" description="Etapas e identificação" />
            <SettingsNavButton active={activeSection === 'locais'} onClick={() => setActiveSection('locais')} icon={<MapPin />} label="Locais" description="Onde os pacotes chegam" />
            <SettingsNavButton active={activeSection === 'lojas'} onClick={() => setActiveSection('lojas')} icon={<Store />} label="Lojas" description="Origem das devoluções" />
            <SettingsNavButton active={activeSection === 'condicoes'} onClick={() => setActiveSection('condicoes')} icon={<CheckCircle2 />} label="Condições" description="Estado dos produtos" />
            <SettingsNavButton active={activeSection === 'regras'} onClick={() => setActiveSection('regras')} icon={<FileCheck2 />} label="Finalização" description="Requisitos obrigatórios" />
            <SettingsNavButton active={activeSection === 'fotos'} onClick={() => setActiveSection('fotos')} icon={<Image />} label="Fotos" description="Limites de captura" />
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <div><p className="text-sm font-semibold text-primary">Administração</p><h1 className="mt-1 text-2xl font-extrabold tracking-[-0.035em] sm:text-3xl">Cadastros do sistema</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Cada área fica em seu próprio painel. Cadastre uma vez e apenas selecione durante o recebimento e a triagem.</p></div>

          {loading && <Card className="grid min-h-40 place-items-center border-0 bg-card ring-border/80"><Loader2 className="size-6 animate-spin text-primary" /></Card>}

          {!loading && (
            <div key={activeSection}>
              {activeSection === 'status' && <SettingsCard id="status" icon={<Settings2 />} title="Status e paleta de cores" description="Escolha qualquer cor e veja a mesma identificação no filtro e na devolução.">
                <div className="flex flex-wrap gap-2 rounded-2xl border bg-muted/25 p-4">
                  {statuses.map((status) => <Badge key={status.code} variant="outline" className={statusClass(status.color)} style={statusStyle(status.color)}><span className="size-2 rounded-full" style={statusDotStyle(status.color)} />{status.label}</Badge>)}
                </div>
                <form onSubmit={createStatus} className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-end">
                  <LabeledInput id="status-name" label="Nome do novo status" value={statusLabel} onChange={setStatusLabel} placeholder="Ex.: Aguardando assistência" />
                  <ColorField id="status-color" label="Cor do status" value={statusColor} onChange={setStatusColor} />
                  <SaveButton saving={saving === 'STATUS'} disabled={!statusLabel.trim()} label="Cadastrar status" />
                </form>
              </SettingsCard>}

              {activeSection === 'locais' && <SettingsCard id="locais" icon={<MapPin />} title="Locais de recebimento" description="Unidades físicas onde as devoluções são recebidas.">
                <OptionChips items={options.locations} />
                <SimpleOptionForm id="location-name" label="Novo local" placeholder="Ex.: Escritório de Curitiba" value={locationLabel} onChange={setLocationLabel} saving={saving === 'LOCATION'} onSubmit={() => createOption('LOCATION')} />
              </SettingsCard>}

              {activeSection === 'lojas' && <SettingsCard id="lojas" icon={<Store />} title="Lojas de origem" description="Lojas, marketplaces ou canais de onde partem as devoluções.">
                <OptionChips items={options.stores} empty="Nenhuma loja cadastrada. Cadastre a primeira abaixo." />
                <SimpleOptionForm id="store-name" label="Nova loja" placeholder="Ex.: Loja Centro" value={storeLabel} onChange={setStoreLabel} saving={saving === 'STORE'} onSubmit={() => createOption('STORE')} />
              </SettingsCard>}

              {activeSection === 'condicoes' && <SettingsCard id="condicoes" icon={<CheckCircle2 />} title="Condições do produto" description="Classificações usadas em cada item devolvido.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {options.conditions.map((condition) => (
                    <div key={condition.code} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
                      <span className="size-3 rounded-full" style={{ backgroundColor: condition.color }} />
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{condition.label}</p><p className="text-xs text-muted-foreground">{condition.requires_invoice ? 'Exige nota de entrada' : 'Dispensa nota'}{condition.requires_notes ? ' · exige descrição' : ''}</p></div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
                  <LabeledInput id="condition-name" label="Nova condição" value={conditionLabel} onChange={setConditionLabel} placeholder="Ex.: Embalagem danificada" />
                  <ColorField id="condition-color" label="Cor" value={conditionColor} onChange={setConditionColor} />
                </div>
                <div className="mt-4 flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:gap-8">
                  <CheckRow checked={conditionRequiresInvoice} onChange={setConditionRequiresInvoice} label="Exigir nota de entrada" />
                  <CheckRow checked={conditionRequiresNotes} onChange={setConditionRequiresNotes} label="Exigir descrição da condição" />
                </div>
                <Button className="mt-4 h-11 rounded-xl" disabled={saving === 'CONDITION' || !conditionLabel.trim()} onClick={() => createOption('CONDITION')}>{saving === 'CONDITION' ? <Loader2 className="animate-spin" /> : <Plus />} Cadastrar condição</Button>
              </SettingsCard>}

              {activeSection === 'regras' && <SettingsCard id="regras" icon={<FileCheck2 />} title="Finalização segura" description="Regras obrigatórias verificadas automaticamente.">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {['Local, loja e identificação preenchidos', 'Todos os produtos com condição definida', 'Destino de cada produto definido', 'Nota apenas quando a condição exigir', 'Teste concluído quando necessário'].map((rule) => <li key={rule} className="flex items-start gap-2.5 rounded-xl border bg-muted/20 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />{rule}</li>)}
                </ul>
              </SettingsCard>}

              {activeSection === 'fotos' && <SettingsCard id="fotos" icon={<Image />} title="Fotos e envio" description="Limites atuais do recebimento pelo celular.">
                <dl className="grid gap-3 sm:grid-cols-3"><Info label="Por devolução" value="Até 8 fotos" /><Info label="Por arquivo" value="Até 10 MB" /><Info label="Acesso" value="Somente autenticado" /></dl>
              </SettingsCard>}
            </div>
          )}

          {error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        </main>
      </div>

      {notice && <output className="fixed bottom-5 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl">{notice}</output>}
    </div>
  );
}

function SettingsNavButton({ active, onClick, icon, label, description }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; description: string }) {
  return <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span className={`grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-[18px] ${active ? 'bg-white/15' : 'bg-muted'}`}>{icon}</span><span className="min-w-0"><span className="block text-sm font-bold">{label}</span><span className={`mt-0.5 block truncate text-[11px] ${active ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{description}</span></span></button>;
}

function SettingsCard({ id, icon, title, description, children }: { id: string; icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <Card id={id} className="scroll-mt-24 border-0 bg-card p-5 shadow-[0_12px_38px_rgb(28_39_36/7%)] ring-border/80 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-5">{icon}</span><div><h2 className="font-bold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div><div className="mt-5">{children}</div></Card>;
}

function OptionChips({ items, empty }: { items: ConfigOption[]; empty?: string }) {
  return <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-2xl border bg-muted/25 p-4">{items.length ? items.map((item) => <Badge key={item.code} variant="outline" className="bg-card"><span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</Badge>) : <p className="text-sm text-muted-foreground">{empty}</p>}</div>;
}

function SimpleOptionForm({ id, label, placeholder, value, onChange, saving, onSubmit }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; saving: boolean; onSubmit: () => void }) {
  return <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div className="min-w-0 flex-1"><LabeledInput id={id} label={label} placeholder={placeholder} value={value} onChange={onChange} /></div><SaveButton saving={saving} disabled={!value.trim()} label="Cadastrar" /></form>;
}

function LabeledInput({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} className="h-11" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={120} /></div>;
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="flex h-11 items-center gap-2 rounded-xl border bg-background px-2"><input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="size-8 cursor-pointer rounded-md border-0 bg-transparent p-0" /><Input aria-label={`${label} em hexadecimal`} value={value.toUpperCase()} onChange={(event) => { const next = event.target.value; if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next); }} className="h-8 border-0 px-1 font-mono uppercase shadow-none focus-visible:ring-0" maxLength={7} /></div></div>;
}

function SaveButton({ saving, disabled, label }: { saving: boolean; disabled: boolean; label: string }) {
  return <Button type="submit" className="h-11 rounded-xl" disabled={saving || disabled}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}{label}</Button>;
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium"><Checkbox checked={checked} onCheckedChange={onChange} />{label}</label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-muted/20 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-bold">{value}</dd></div>;
}
