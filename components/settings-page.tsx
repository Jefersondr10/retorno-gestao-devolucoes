'use client';

import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, HardDrive, Loader2, MapPin, PackageCheck, Pencil, Plus, Power, Save, Settings2, Store, Tags, Trash2, UsersRound } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { UserManagementSection } from '@/components/user-management-section';
import { UserMenu } from '@/components/user-menu';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth';
import { getFirstAllowedRoute, hasUserPermission } from '@/lib/permissions';
import type { ConfigOption, ConfigOptionsResponse, RetentionOverview, StatusDefinition } from '@/lib/returns';
import { statusDotStyle, statusHex } from '@/lib/status-colors';

const emptyOptions: ConfigOptionsResponse = { locations: [], stores: [], conditions: [] };
const essentialStatuses = new Set(['PENDING_INFO', 'WAITING_TEST', 'WAITING_ENTRY', 'READY', 'FINALIZED']);
type SettingsSection = 'status' | 'locais' | 'lojas' | 'condicoes' | 'retencao' | 'usuarios';
type EditTarget = {
  kind: 'STATUS' | 'OPTION';
  code: string;
  label: string;
  color?: string;
  optionType?: ConfigOption['type'];
  requiresInvoice?: boolean;
  requiresNotes?: boolean;
};
type RetentionDraft = Pick<RetentionOverview, 'automaticEnabled' | 'photoRetentionDays' | 'returnRetentionDays'>;

export function SettingsPage({ currentUser }: { currentUser: AuthUser }) {
  const canManageSettings = hasUserPermission(currentUser, 'settings.manage');
  const canManageRetention = hasUserPermission(currentUser, 'retention.manage');
  const canManageUsers = hasUserPermission(currentUser, 'team.manage');
  const canCreateReturns = hasUserPermission(currentUser, 'returns.create');
  const defaultSection: SettingsSection = canManageSettings ? 'status' : canManageRetention ? 'retencao' : 'usuarios';
  const [activeSection, setActiveSection] = useState<SettingsSection>(defaultSection);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [options, setOptions] = useState<ConfigOptionsResponse>(emptyOptions);
  const [retention, setRetention] = useState<RetentionOverview | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<RetentionDraft>({ automaticEnabled: false, photoRetentionDays: 90, returnRetentionDays: 365 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [statusLabel, setStatusLabel] = useState('');
  const [statusColor, setStatusColor] = useState('#64748b');
  const [locationLabel, setLocationLabel] = useState('');
  const [storeLabel, setStoreLabel] = useState('');
  const [storeColor, setStoreColor] = useState('#2563eb');
  const [conditionLabel, setConditionLabel] = useState('');
  const [conditionColor, setConditionColor] = useState('#64748b');
  const [conditionRequiresInvoice, setConditionRequiresInvoice] = useState(true);
  const [conditionRequiresNotes, setConditionRequiresNotes] = useState(false);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      if (canManageSettings) {
        const [statusResponse, optionResponse] = await Promise.all([
          apiFetch('/api/config/statuses?includeInactive=true'),
          apiFetch('/api/config/options?includeInactive=true'),
        ]);
        const statusResult = (await statusResponse.json()) as { items?: StatusDefinition[]; error?: string };
        const optionResult = (await optionResponse.json()) as ConfigOptionsResponse & { error?: string };
        if (!statusResponse.ok) throw new Error(statusResult.error || 'Não foi possível carregar os status.');
        if (!optionResponse.ok) throw new Error(optionResult.error || 'Não foi possível carregar os cadastros.');
        setStatuses(statusResult.items || []);
        setOptions(optionResult);
      }
      if (canManageRetention) {
        const retentionResponse = await apiFetch('/api/config/retention');
        const retentionResult = (await retentionResponse.json()) as { item?: RetentionOverview; error?: string };
        if (!retentionResponse.ok || !retentionResult.item) throw new Error(retentionResult.error || 'Não foi possível carregar a retenção.');
        setRetention(retentionResult.item);
        setRetentionDraft({ automaticEnabled: retentionResult.item.automaticEnabled, photoRetentionDays: retentionResult.item.photoRetentionDays, returnRetentionDays: retentionResult.item.returnRetentionDays });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as configurações.');
    } finally { setLoading(false); }
  }, [canManageRetention, canManageSettings]);

  useEffect(() => { const timer = window.setTimeout(() => void loadAll(), 0); return () => window.clearTimeout(timer); }, [loadAll]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4500); return () => window.clearTimeout(timer); }, [notice]);

  async function createStatus(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusLabel.trim()) return;
    setSaving('CREATE_STATUS'); setError('');
    try {
      const response = await apiFetch('/api/config/statuses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: statusLabel, color: statusColor }) });
      const result = (await response.json()) as { item?: StatusDefinition; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível cadastrar o status.');
      setStatusLabel(''); setNotice(`Status “${result.item.label}” cadastrado.`); await loadAll();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível cadastrar o status.'); }
    finally { setSaving(''); }
  }

  async function createOption(type: 'LOCATION' | 'STORE' | 'CONDITION') {
    const label = type === 'LOCATION' ? locationLabel : type === 'STORE' ? storeLabel : conditionLabel;
    if (!label.trim()) return;
    setSaving(`CREATE_${type}`); setError('');
    try {
      const response = await apiFetch('/api/config/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, label, color: type === 'CONDITION' ? conditionColor : type === 'LOCATION' ? '#0f766e' : storeColor, requiresInvoice: conditionRequiresInvoice, requiresNotes: conditionRequiresNotes }) });
      const result = (await response.json()) as { item?: ConfigOption; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível salvar o cadastro.');
      if (type === 'LOCATION') setLocationLabel('');
      if (type === 'STORE') setStoreLabel('');
      if (type === 'CONDITION') { setConditionLabel(''); setConditionRequiresInvoice(true); setConditionRequiresNotes(false); }
      setNotice(`${type === 'LOCATION' ? 'Local' : type === 'STORE' ? 'Loja' : 'Condição'} “${result.item.label}” cadastrado.`); await loadAll();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar o cadastro.'); }
    finally { setSaving(''); }
  }

  async function updateStatus(status: StatusDefinition, changes: { label?: string; color?: string; active?: boolean }) {
    setSaving(status.code); setError('');
    try {
      const response = await apiFetch(`/api/config/statuses/${encodeURIComponent(status.code)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const result = (await response.json()) as { item?: StatusDefinition; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível atualizar o status.');
      setNotice(`Status “${result.item.label}” atualizado.`); await loadAll();
      return true;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar o status.'); return false; }
    finally { setSaving(''); }
  }

  async function updateOption(option: ConfigOption, changes: { label?: string; color?: string; active?: boolean; requiresInvoice?: boolean; requiresNotes?: boolean }) {
    setSaving(option.code); setError('');
    try {
      const response = await apiFetch(`/api/config/options/${encodeURIComponent(option.code)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const result = (await response.json()) as { item?: ConfigOption; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível atualizar o cadastro.');
      setNotice(`“${result.item.label}” atualizado.`); await loadAll();
      return true;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar o cadastro.'); return false; }
    finally { setSaving(''); }
  }

  async function deleteStatus(status: StatusDefinition) {
    if (!window.confirm(`Excluir definitivamente o status “${status.label}”? Esta ação não pode ser desfeita.`)) return;
    setSaving(status.code); setError('');
    try {
      const response = await apiFetch(`/api/config/statuses/${encodeURIComponent(status.code)}`, { method: 'DELETE' });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir o status.');
      setNotice(`Status “${status.label}” excluído.`); await loadAll();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir o status.'); }
    finally { setSaving(''); }
  }

  async function deleteOption(option: ConfigOption) {
    if (!window.confirm(`Excluir definitivamente “${option.label}”? Esta ação não pode ser desfeita.`)) return;
    setSaving(option.code); setError('');
    try {
      const response = await apiFetch(`/api/config/options/${encodeURIComponent(option.code)}`, { method: 'DELETE' });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir o cadastro.');
      setNotice(`“${option.label}” excluído.`); await loadAll();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir o cadastro.'); }
    finally { setSaving(''); }
  }

  async function saveEdit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    const target = editTarget;
    let saved = false;
    if (target.kind === 'STATUS') { const status = statuses.find((item) => item.code === target.code); if (status) saved = await updateStatus(status, { label: target.label, color: target.color }); }
    else {
      const option = [...options.locations, ...options.stores, ...options.conditions].find((item) => item.code === target.code);
      if (option) saved = await updateOption(option, {
        label: target.label,
        color: target.color,
        requiresInvoice: target.optionType === 'CONDITION' ? target.requiresInvoice : undefined,
        requiresNotes: target.optionType === 'CONDITION' ? target.requiresNotes : undefined,
      });
    }
    if (saved) setEditTarget(null);
  }

  async function saveRetention(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving('RETENTION'); setError('');
    try {
      const response = await apiFetch('/api/config/retention', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retentionDraft) });
      const result = (await response.json()) as { item?: RetentionOverview; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível salvar a retenção.');
      setRetention(result.item); setNotice('Política de retenção salva.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar a retenção.'); }
    finally { setSaving(''); }
  }

  async function runCleanup() {
    const total = (retention?.eligiblePhotos || 0) + (retention?.eligibleVideos || 0) + (retention?.eligibleReturns || 0);
    if (!total || !window.confirm(`Executar a limpeza agora? Há ${retention?.eligiblePhotos || 0} foto(s), ${retention?.eligibleVideos || 0} vídeo(s) e ${retention?.eligibleReturns || 0} devolução(ões) elegíveis. A exclusão é permanente e será processada em lotes até terminar.`)) return;
    setSaving('CLEANUP'); setError('');
    try {
      let latestOverview: RetentionOverview | null = null;
      let previousRemaining = total;
      for (let batch = 0; batch < 20; batch += 1) {
        const response = await apiFetch('/api/config/retention', { method: 'POST' });
        const result = (await response.json()) as { overview?: RetentionOverview; error?: string };
        if (!response.ok || !result.overview) throw new Error(result.error || 'Não foi possível executar a limpeza.');
        latestOverview = result.overview;
        const remaining = latestOverview.eligiblePhotos + latestOverview.eligibleVideos + latestOverview.eligibleReturns;
        if (remaining === 0 || remaining >= previousRemaining) break;
        previousRemaining = remaining;
      }
      if (!latestOverview) throw new Error('Não foi possível executar a limpeza.');
      const remaining = latestOverview.eligiblePhotos + latestOverview.eligibleVideos + latestOverview.eligibleReturns;
      setRetention(latestOverview); setRetentionDraft({ automaticEnabled: latestOverview.automaticEnabled, photoRetentionDays: latestOverview.photoRetentionDays, returnRetentionDays: latestOverview.returnRetentionDays }); setNotice(remaining ? `Lotes concluídos. Ainda restam ${remaining} item(ns); execute novamente para continuar.` : 'Limpeza concluída.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível executar a limpeza.'); }
    finally { setSaving(''); }
  }

  return (
    <div className="app-shell min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/75 bg-background/88 shadow-[0_1px_0_rgb(255_255_255/45%)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 min-w-0 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
          <button type="button" onClick={() => window.location.assign(getFirstAllowedRoute(currentUser))} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Voltar ao sistema"><ArrowLeft className="size-5" /></button>
          <div className="hidden size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-[0_8px_20px_rgb(13_96_83/20%)] sm:grid"><PackageCheck className="size-5" /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-base font-semibold">Configurações</p><p className="truncate text-xs text-muted-foreground">Cadastros, arquivos e acessos</p></div>
          {canCreateReturns && <Button className="hidden h-10 shrink-0 rounded-xl lg:inline-flex" onClick={() => window.location.assign('/receber')}><Plus /> Nova devolução</Button>}
          <div className="shrink-0"><UserMenu user={currentUser} /></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-9">
        <div><p className="text-sm font-semibold text-primary">Administração</p><h1 className="display-title mt-1 text-2xl sm:text-3xl">Configurações do sistema</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Edite os cadastros e controle quanto tempo fotos, vídeos e devoluções finalizadas permanecem armazenados.</p></div>
        <div className="mt-6 lg:hidden"><Label htmlFor="settings-section" className="mb-2 block">Área de configuração</Label><NativeSelect id="settings-section" className="h-11 w-full bg-card" value={activeSection} onChange={(event) => setActiveSection(event.target.value as SettingsSection)}>{canManageSettings && <><NativeSelectOption value="status">Status e cores</NativeSelectOption><NativeSelectOption value="locais">Locais</NativeSelectOption><NativeSelectOption value="lojas">Lojas e cores</NativeSelectOption><NativeSelectOption value="condicoes">Condições</NativeSelectOption></>}{canManageRetention && <NativeSelectOption value="retencao">Arquivos e retenção</NativeSelectOption>}{canManageUsers && <NativeSelectOption value="usuarios">Usuários e acessos</NativeSelectOption>}</NativeSelect></div>
        <nav aria-label="Seções de configurações" className="mt-6 hidden grid-cols-2 gap-2 rounded-2xl border bg-card/90 p-2 shadow-[var(--shadow-card)] lg:grid lg:grid-cols-3 xl:grid-cols-6">{canManageSettings && <><TopNav active={activeSection === 'status'} onClick={() => setActiveSection('status')} icon={<Tags />} label="Status e cores" /><TopNav active={activeSection === 'locais'} onClick={() => setActiveSection('locais')} icon={<MapPin />} label="Locais" /><TopNav active={activeSection === 'lojas'} onClick={() => setActiveSection('lojas')} icon={<Store />} label="Lojas e cores" /><TopNav active={activeSection === 'condicoes'} onClick={() => setActiveSection('condicoes')} icon={<CheckCircle2 />} label="Condições" /></>}{canManageRetention && <TopNav active={activeSection === 'retencao'} onClick={() => setActiveSection('retencao')} icon={<HardDrive />} label="Arquivos e retenção" />}{canManageUsers && <TopNav active={activeSection === 'usuarios'} onClick={() => setActiveSection('usuarios')} icon={<UsersRound />} label="Usuários e acessos" />}</nav>

        <main className="mt-6 min-w-0">
          {loading ? <Card className="grid min-h-48 place-items-center border-0 bg-card ring-border/80"><Loader2 className="size-6 animate-spin text-primary" /></Card> : <>
            {activeSection === 'status' && <SettingsCard icon={<Settings2 />} title="Status e paleta de cores" description="Edite nomes e cores. Status personalizados podem ser inativados ou excluídos quando não estiverem em uso."><form onSubmit={createStatus} className="grid gap-4 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"><LabeledInput id="status-name" label="Novo status" value={statusLabel} onChange={setStatusLabel} placeholder="Ex.: Aguardando assistência" /><ColorField id="status-color" label="Cor" value={statusColor} onChange={setStatusColor} /><SaveButton saving={saving === 'CREATE_STATUS'} disabled={!statusLabel.trim()} label="Cadastrar" /></form><div className="mt-5 grid gap-2">{statuses.map((status) => <StatusRow key={status.code} status={status} busy={saving === status.code} onEdit={() => setEditTarget({ kind: 'STATUS', code: status.code, label: status.label, color: statusHex(status.color) })} onToggle={() => void updateStatus(status, { active: !status.active })} onDelete={() => void deleteStatus(status)} />)}</div></SettingsCard>}
            {activeSection === 'locais' && <SettingsCard icon={<MapPin />} title="Locais de recebimento" description="Renomear um local atualiza também as devoluções já registradas com ele."><SimpleOptionForm id="location-name" label="Novo local" placeholder="Ex.: Escritório de Curitiba" value={locationLabel} onChange={setLocationLabel} saving={saving === 'CREATE_LOCATION'} onSubmit={() => void createOption('LOCATION')} /><ManagedOptions className="mt-5" items={options.locations} busy={saving} onEdit={(item) => setEditTarget({ kind: 'OPTION', code: item.code, label: item.label, optionType: item.type })} onToggle={(item) => void updateOption(item, { active: !item.active })} onDelete={(item) => void deleteOption(item)} /></SettingsCard>}
            {activeSection === 'lojas' && <SettingsCard icon={<Store />} title="Lojas e cores" description="Use uma cor para reconhecer cada loja rapidamente nos filtros e nas devoluções."><form onSubmit={(event) => { event.preventDefault(); void createOption('STORE'); }} className="grid gap-4 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(190px,240px)_auto] sm:items-end"><LabeledInput id="store-name" label="Nova loja" placeholder="Ex.: Loja Centro" value={storeLabel} onChange={setStoreLabel} /><ColorField id="store-color" label="Cor da loja" value={storeColor} onChange={setStoreColor} /><SaveButton saving={saving === 'CREATE_STORE'} disabled={!storeLabel.trim()} label="Cadastrar" /></form><ManagedOptions className="mt-5" items={options.stores} busy={saving} empty="Nenhuma loja cadastrada." showColor onEdit={(item) => setEditTarget({ kind: 'OPTION', code: item.code, label: item.label, color: statusHex(item.color), optionType: item.type })} onToggle={(item) => void updateOption(item, { active: !item.active })} onDelete={(item) => void deleteOption(item)} /></SettingsCard>}
            {activeSection === 'condicoes' && <SettingsCard icon={<CheckCircle2 />} title="Condições do produto" description="Cadastre, edite, inative ou exclua as classificações e escolha o que cada uma exige para finalizar."><form onSubmit={(event) => { event.preventDefault(); void createOption('CONDITION'); }} className="rounded-2xl border bg-muted/20 p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]"><LabeledInput id="condition-name" label="Nova condição" value={conditionLabel} onChange={setConditionLabel} placeholder="Ex.: Embalagem danificada" /><ColorField id="condition-color" label="Cor" value={conditionColor} onChange={setConditionColor} /></div><div className="mt-4 flex flex-col gap-3 rounded-xl border bg-card/70 p-4 sm:flex-row sm:gap-8"><CheckRow checked={conditionRequiresInvoice} onChange={setConditionRequiresInvoice} label="Exigir nota de entrada" /><CheckRow checked={conditionRequiresNotes} onChange={setConditionRequiresNotes} label="Exigir preenchimento de “Condições encontradas”" /></div><div className="mt-4"><SaveButton saving={saving === 'CREATE_CONDITION'} disabled={!conditionLabel.trim()} label="Cadastrar condição" /></div></form><ManagedOptions className="mt-5" items={options.conditions} busy={saving} empty="Nenhuma condição cadastrada." showColor showPolicies onEdit={(item) => setEditTarget({ kind: 'OPTION', code: item.code, label: item.label, color: statusHex(item.color), optionType: item.type, requiresInvoice: Boolean(item.requires_invoice), requiresNotes: Boolean(item.requires_notes) })} onToggle={(item) => void updateOption(item, { active: !item.active })} onDelete={(item) => void deleteOption(item)} /></SettingsCard>}
            {activeSection === 'retencao' && <SettingsCard icon={<HardDrive />} title="Arquivos, espaço e retenção" description="Fotos são otimizadas para zoom e vídeos ficam limitados a trechos curtos. Você decide quando remover os arquivos e os registros finalizados."><dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Info label="Qualidade das fotos" value="Até 2048 px" detail="JPEG compatível e nítido" /><Info label="Foto máxima" value="2,5 MB" detail="Compressão automática" /><Info label="Vídeo curto" value="Até 20 s" detail="1 vídeo · até 40 MB" /><Info label="Por devolução" value="Até 8 fotos" detail="Mais 1 vídeo opcional" /></dl><form onSubmit={saveRetention} className="mt-6 space-y-5 rounded-2xl border bg-muted/20 p-4 sm:p-5"><CheckRow checked={retentionDraft.automaticEnabled} onChange={(checked) => setRetentionDraft((current) => ({ ...current, automaticEnabled: checked }))} label="Ativar exclusão automática" /><p className="text-xs leading-5 text-muted-foreground">A verificação ocorre periodicamente quando o sistema é utilizado. Somente devoluções finalizadas entram na limpeza.</p><div className="grid gap-4 sm:grid-cols-2"><NumberField id="photo-days" label="Excluir fotos e vídeos depois de" suffix="dias" value={retentionDraft.photoRetentionDays} min={7} onChange={(value) => setRetentionDraft((current) => ({ ...current, photoRetentionDays: value }))} /><NumberField id="return-days" label="Excluir registro completo depois de" suffix="dias" value={retentionDraft.returnRetentionDays} min={30} onChange={(value) => setRetentionDraft((current) => ({ ...current, returnRetentionDays: value }))} /></div><Alert className="border-amber-200 bg-amber-50 text-amber-900"><AlertCircle /><AlertTitle>Exclusão permanente</AlertTitle><AlertDescription>Confirme as obrigações fiscais antes de apagar devoluções com nota de entrada. O prazo é contado a partir da finalização.</AlertDescription></Alert><Button type="submit" className="h-11" disabled={saving === 'RETENTION'}>{saving === 'RETENTION' ? <Loader2 className="animate-spin" /> : <Save />} Salvar política</Button></form>{retention && <div className="mt-5 rounded-2xl border p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-3"><Info label="Arquivos elegíveis agora" value={String(retention.eligiblePhotos + retention.eligibleVideos)} detail={`${formatBytes(retention.eligiblePhotoBytes + retention.eligibleVideoBytes)} · ${retention.eligiblePhotos} foto(s) e ${retention.eligibleVideos} vídeo(s)`} /><Info label="Registros elegíveis agora" value={String(retention.eligibleReturns)} detail="Devoluções finalizadas" /><Info label="Última limpeza" value={retention.lastCleanupAt ? formatDate(retention.lastCleanupAt) : 'Ainda não executada'} detail={retention.lastCleanupAt ? `${retention.lastCleanupPhotos} fotos · ${retention.lastCleanupVideos} vídeos · ${retention.lastCleanupReturns} registros` : 'Nenhum dado removido'} /></div><Button type="button" variant="destructive" className="mt-4 h-11" disabled={saving === 'CLEANUP' || retention.eligiblePhotos + retention.eligibleVideos + retention.eligibleReturns === 0} onClick={() => void runCleanup()}>{saving === 'CLEANUP' ? <Loader2 className="animate-spin" /> : <Trash2 />} Executar limpeza agora</Button></div>}</SettingsCard>}
            {activeSection === 'usuarios' && <SettingsCard icon={<UsersRound />} title="Usuários e acessos" description="Crie acessos individuais para sua equipe, escolha permissões e encerre o acesso de quem não faz mais parte da operação."><UserManagementSection currentUser={currentUser} /></SettingsCard>}
          </>}
          {error && <Alert variant="destructive" className="mt-5"><AlertCircle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        </main>
      </div>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && saving !== editTarget?.code && setEditTarget(null)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Editar {editTarget?.kind === 'STATUS' ? 'status' : editTarget?.optionType === 'CONDITION' ? 'condição' : 'cadastro'}</DialogTitle><DialogDescription>{editTarget?.optionType === 'CONDITION' ? 'As exigências serão aplicadas imediatamente às devoluções ainda abertas.' : 'A alteração será usada nas próximas seleções.'}</DialogDescription></DialogHeader>{editTarget && <form onSubmit={saveEdit}><fieldset disabled={saving === editTarget.code} className="space-y-4 disabled:opacity-75"><LabeledInput id="edit-name" label="Nome" value={editTarget.label} onChange={(label) => setEditTarget((current) => current ? { ...current, label } : current)} placeholder="Nome do cadastro" />{editTarget.color && <ColorField id="edit-color" label="Cor" value={editTarget.color} onChange={(color) => setEditTarget((current) => current ? { ...current, color } : current)} />}{editTarget.optionType === 'CONDITION' && <div className="space-y-1 rounded-xl border bg-muted/25 p-3"><CheckRow checked={Boolean(editTarget.requiresInvoice)} onChange={(requiresInvoice) => setEditTarget((current) => current ? { ...current, requiresInvoice } : current)} label="Exigir nota de entrada para finalizar" /><CheckRow checked={Boolean(editTarget.requiresNotes)} onChange={(requiresNotes) => setEditTarget((current) => current ? { ...current, requiresNotes } : current)} label="Exigir preenchimento de “Condições encontradas”" /></div>}<DialogFooter className="mx-0 mb-0 rounded-b-xl px-0 pb-0"><Button type="button" variant="outline" disabled={saving === editTarget.code} onClick={() => setEditTarget(null)}>Cancelar</Button><Button type="submit" disabled={saving === editTarget.code}>{saving === editTarget.code ? <Loader2 className="animate-spin" /> : <Save />} {saving === editTarget.code ? 'Salvando…' : 'Salvar alteração'}</Button></DialogFooter></fieldset></form>}</DialogContent></Dialog>
      {notice && <output className="fixed bottom-5 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl">{notice}</output>}
    </div>
  );
}

function TopNav({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) { return <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:size-[18px] ${active ? 'bg-primary/10 text-primary ring-1 ring-primary/15' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{icon}{label}</button>; }
function SettingsCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) { return <Card className="border-0 bg-card p-5 shadow-[var(--shadow-card)] ring-border/80 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&>svg]:size-5">{icon}</span><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p></div></div><div className="mt-5">{children}</div></Card>; }
function StatusRow({ status, busy, onEdit, onToggle, onDelete }: { status: StatusDefinition; busy: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void }) { const canToggle = !essentialStatuses.has(status.code); const canDelete = !status.is_system && Number(status.usage_count || 0) === 0; return <div className={`flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center ${status.active ? 'bg-card' : 'bg-muted/35 opacity-75'}`}><div className="flex min-w-0 flex-1 items-center gap-3"><span className="size-3 shrink-0 rounded-full" style={statusDotStyle(status.color)} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold">{status.label}</p><Badge variant={status.active ? 'secondary' : 'outline'}>{status.active ? 'Ativo' : 'Inativo'}</Badge>{status.is_system ? <Badge variant="outline">Sistema</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">{Number(status.usage_count || 0)} devolução(ões) usando este status</p></div></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={onEdit}><Pencil /> Editar</Button><Button type="button" size="sm" variant="outline" disabled={busy || !canToggle} title={!canToggle ? 'Status essencial do sistema' : undefined} onClick={onToggle}><Power /> {status.active ? 'Inativar' : 'Ativar'}</Button><Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy || !canDelete} title={!canDelete ? 'Só é possível excluir status personalizado e sem uso' : undefined} onClick={onDelete}><Trash2 /> Excluir</Button></div></div>; }
function ManagedOptions({ items, busy, empty = 'Nenhum cadastro encontrado.', className = '', showColor = false, showPolicies = false, onEdit, onToggle, onDelete }: { items: ConfigOption[]; busy: string; empty?: string; className?: string; showColor?: boolean; showPolicies?: boolean; onEdit: (item: ConfigOption) => void; onToggle: (item: ConfigOption) => void; onDelete: (item: ConfigOption) => void }) {
  if (!items.length) return <div className={`${className} rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground`}>{empty}</div>;
  return <div className={`${className} grid gap-2`}>{items.map((item) => {
    const canDelete = !item.is_system && Number(item.usage_count || 0) === 0;
    return <div key={item.code} className={`flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center ${item.active ? 'bg-card' : 'bg-muted/35 opacity-75'}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showColor && <span className="size-3 shrink-0 rounded-full ring-4 ring-background" style={{ backgroundColor: item.color }} aria-hidden="true" />}
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{item.label}</p><Badge variant={item.active ? 'secondary' : 'outline'}>{item.active ? 'Ativo' : 'Inativo'}</Badge>{item.is_system ? <Badge variant="outline">Padrão</Badge> : null}</div>{showPolicies && <p className="mt-1 text-xs font-medium text-muted-foreground">{item.requires_invoice ? 'Nota obrigatória' : 'Nota dispensada'} · {item.requires_notes ? 'Descrição obrigatória' : 'Descrição opcional'}</p>}<p className="mt-1 text-xs text-muted-foreground">{Number(item.usage_count || 0)} devolução(ões) usando este cadastro</p></div>
      </div>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy === item.code} onClick={() => onEdit(item)}><Pencil /> Editar</Button><Button type="button" size="sm" variant="outline" disabled={busy === item.code} onClick={() => onToggle(item)}><Power /> {item.active ? 'Inativar' : 'Ativar'}</Button><Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy === item.code || !canDelete} title={!canDelete ? 'Só é possível excluir cadastros personalizados e sem uso' : undefined} onClick={() => onDelete(item)}><Trash2 /> Excluir</Button></div>
    </div>;
  })}</div>;
}
function SimpleOptionForm({ id, label, placeholder, value, onChange, saving, onSubmit }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; saving: boolean; onSubmit: () => void }) { return <form className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div className="min-w-0 flex-1"><LabeledInput id={id} label={label} placeholder={placeholder} value={value} onChange={onChange} /></div><SaveButton saving={saving} disabled={!value.trim()} label="Cadastrar" /></form>; }
function LabeledInput({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} className="h-11" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={120} /></div>; }
function NumberField({ id, label, suffix, value, min, onChange }: { id: string; label: string; suffix: string; value: number; min: number; onChange: (value: number) => void }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="flex items-center gap-2"><Input id={id} type="number" min={min} max={3650} className="h-11" value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="text-sm text-muted-foreground">{suffix}</span></div></div>; }
const colorPresets = ['#0f766e', '#16a34a', '#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#dc2626', '#64748b'];
function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="flex h-11 items-center gap-2 rounded-xl border bg-background px-2"><input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="size-8 cursor-pointer rounded-md border-0 bg-transparent p-0" /><Input aria-label={`${label} em hexadecimal`} value={value.toUpperCase()} onChange={(event) => { const next = event.target.value; if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next); }} className="h-8 border-0 px-1 font-mono uppercase shadow-none focus-visible:ring-0" maxLength={7} /></div><div className="flex flex-wrap gap-1.5" aria-label="Cores sugeridas">{colorPresets.map((color) => <button key={color} type="button" className={`size-7 rounded-full border-2 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${value.toLowerCase() === color ? 'border-foreground' : 'border-background ring-1 ring-border'}`} style={{ backgroundColor: color }} onClick={() => onChange(color)} aria-label={`Usar cor ${color}`} aria-pressed={value.toLowerCase() === color} />)}</div></div>; }
function SaveButton({ saving, disabled, label }: { saving: boolean; disabled: boolean; label: string }) { return <Button type="submit" className="h-11 rounded-xl" disabled={saving || disabled}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}{label}</Button>; }
function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><Checkbox checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} />{label}</label>; }
function Info({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl border bg-muted/20 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-bold">{value}</dd><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>; }
function formatBytes(bytes: number) { if (bytes <= 0) return 'Nenhum espaço'; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
