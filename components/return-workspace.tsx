'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowLeft,
  Box,
  Camera,
  CheckCircle2,
  FileCheck2,
  History,
  Loader2,
  MapPin,
  PackagePlus,
  Save,
  Trash2,
  Truck,
} from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { ReturnPhotoGallery } from '@/components/return-photo-gallery';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  destinationOptions,
  getBlockingReasons,
  updateReturnSchema,
  type ConfigOption,
  type ConfigOptionsResponse,
  type ReturnDetail,
  type StatusDefinition,
} from '@/lib/returns';
import { statusClass, statusDotStyle, statusStyle } from '@/lib/status-colors';
import { cn } from '@/lib/utils';

type UpdateInput = z.input<typeof updateReturnSchema>;
type UpdateOutput = z.output<typeof updateReturnSchema>;

function toLocalInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function mapDetail(item: ReturnDetail): UpdateInput {
  return {
    store: item.store || '',
    receivedLocation: item.received_location || '',
    receivedAt: toLocalInput(item.received_at),
    orderId: item.order_id || '',
    trackingCode: item.tracking_code || '',
    status: item.status,
    notes: item.notes || '',
    invoiceNumber: item.invoice_number || '',
    invoiceDate: item.invoice_date?.slice(0, 10) || '',
    items: item.items.map((product) => ({
      id: product.id,
      product: product.product,
      sku: product.sku || '',
      quantity: product.quantity,
      condition: product.condition || '',
      conditionNotes: product.condition_notes || '',
      destination: product.destination || '',
      testResult: product.test_result || '',
      notes: product.notes || '',
    })),
  };
}

export function ReturnWorkspace({ returnId, embedded = false, onClose }: { returnId: string; embedded?: boolean; onClose?: () => void }) {
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [options, setOptions] = useState<ConfigOptionsResponse>({ locations: [], stores: [], conditions: [] });
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState('');
  const [notice, setNotice] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  const form = useForm<UpdateInput, unknown, UpdateOutput>({
    resolver: zodResolver(updateReturnSchema),
    defaultValues: {
      store: '',
      receivedLocation: '',
      receivedAt: '',
      orderId: '',
      trackingCode: '',
      status: 'PENDING_INFO',
      notes: '',
      invoiceNumber: '',
      invoiceDate: '',
      items: [],
    },
  });
  const itemFields = useFieldArray({ control: form.control, name: 'items', keyName: 'fieldKey' });
  const values = form.watch();
  const invoiceExemptConditions = useMemo(() => options.conditions.filter((condition) => !condition.requires_invoice).map((condition) => condition.code), [options.conditions]);
  const noteRequiredConditions = useMemo(() => options.conditions.filter((condition) => condition.requires_notes).map((condition) => condition.code), [options.conditions]);
  const blockingReasons = useMemo(() => getBlockingReasons({
    store: values.store,
    received_at: values.receivedAt,
    order_id: values.orderId,
    tracking_code: values.trackingCode,
    invoice_number: values.invoiceNumber,
    status: values.status,
    items: values.items?.map((item) => ({
      product: item.product,
      quantity: Number(item.quantity),
      condition: item.condition,
      condition_notes: item.conditionNotes,
      destination: item.destination,
    })),
  }, invoiceExemptConditions, noteRequiredConditions), [invoiceExemptConditions, noteRequiredConditions, values]);
  const allItemsInvoiceExempt = Boolean(values.items?.length) && values.items!.every((item) => item.condition && invoiceExemptConditions.includes(item.condition));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/returns/${returnId}`).then(async (response) => {
        const result = (await response.json()) as { item?: ReturnDetail; error?: string };
        if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível abrir a devolução.');
        return result.item;
      }),
      fetch('/api/config/statuses?includeInactive=true').then(async (response) => {
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
      .then(([loadedDetail, loadedStatuses, loadedOptions]) => {
        if (cancelled) return;
        setDetail(loadedDetail);
        setStatuses(loadedStatuses);
        setOptions(loadedOptions);
        form.reset(mapDetail(loadedDetail));
      })
      .catch((error) => !cancelled && setServerError(error instanceof Error ? error.message : 'Não foi possível abrir a devolução.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [form, returnId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function save(data: UpdateOutput) {
    setServerError('');
    const parsedDate = new Date(data.receivedAt);
    const payload = { ...data, receivedAt: Number.isNaN(parsedDate.getTime()) ? data.receivedAt : parsedDate.toISOString() };
    try {
      const response = await fetch(`/api/returns/${returnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { item?: ReturnDetail; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível salvar.');
      setDetail(result.item);
      form.reset(mapDetail(result.item));
      setNotice('Alterações salvas com sucesso.');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível salvar.');
    }
  }

  async function finalize() {
    if (!detail || blockingReasons.length > 0 || form.formState.isDirty) return;
    if (!window.confirm(`Finalizar ${detail.protocol}? Depois disso, o registro ficará bloqueado para edição.`)) return;
    setFinalizing(true);
    setServerError('');
    try {
      const response = await fetch(`/api/returns/${returnId}/finalize`, { method: 'POST' });
      const result = (await response.json()) as { item?: ReturnDetail; error?: string; details?: { blockingReasons?: string[] } };
      if (!response.ok || !result.item) throw new Error(result.details?.blockingReasons?.join(' ') || result.error || 'Não foi possível finalizar.');
      setDetail(result.item);
      form.reset(mapDetail(result.item));
      setNotice(`${result.item.protocol} finalizada.`);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível finalizar.');
    } finally {
      setFinalizing(false);
    }
  }

  async function refreshAfterVideoDeletion(count: number, storagePending: boolean) {
    const response = await fetch(`/api/returns/${returnId}`);
    const result = (await response.json()) as { item?: ReturnDetail; error?: string };
    if (!response.ok || !result.item) throw new Error(result.error || 'Os vídeos foram excluídos, mas não foi possível atualizar a tela.');
    setDetail(result.item);
    form.reset(mapDetail(result.item));
    setNotice(storagePending
      ? 'Vídeo removido da devolução. A liberação do espaço continuará automaticamente.'
      : count === 1 ? 'Vídeo excluído. Fotos e dados foram mantidos.' : `${count} vídeos excluídos. Fotos e dados foram mantidos.`);
  }

  if (loading) return <div className={cn('grid place-items-center bg-background text-muted-foreground', embedded ? 'h-full min-h-80' : 'min-h-screen')}><div className="text-center"><Loader2 className="mx-auto size-7 animate-spin text-primary" /><p className="mt-3 text-sm">Abrindo devolução...</p></div></div>;
  if (!detail) return <div className={cn('grid place-items-center bg-background p-4', embedded ? 'h-full min-h-80' : 'min-h-screen')}><Alert variant="destructive" className="max-w-lg"><AlertCircle /><AlertTitle>Não foi possível abrir</AlertTitle><AlertDescription>{serverError || 'Tente novamente.'}</AlertDescription></Alert></div>;

  const finalized = detail.status === 'FINALIZED';
  const selectedStatus = statuses.find((status) => status.code === values.status) || statuses.find((status) => status.code === detail.status);
  const locationOptions = mergeCurrentOption(options.locations, detail.received_location);
  const storeOptions = mergeCurrentOption(options.stores, detail.store);
  const goBack = () => {
    if (onClose) {
      onClose();
      return;
    }
    window.location.assign('/');
  };

  return (
    <form className={cn('bg-background text-foreground', embedded ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'min-h-screen')} onSubmit={form.handleSubmit(save)}>
      <header className={cn('z-40 shrink-0 border-b bg-background/95 backdrop-blur-xl', !embedded && 'sticky top-0')}>
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 py-2 sm:px-6">
          <button type="button" onClick={goBack} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={embedded ? 'Fechar devolução e voltar à lista' : 'Voltar às devoluções'}><ArrowLeft className="size-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold tracking-tight tabular-nums">{detail.protocol}</h1><Badge variant="outline" className={statusClass(selectedStatus?.color || detail.status_color)} style={statusStyle(selectedStatus?.color || detail.status_color)}><span className="size-2 rounded-full" style={statusDotStyle(selectedStatus?.color || detail.status_color)} />{selectedStatus?.label || detail.status_label}</Badge>{detail.source === 'PHOTO' && <Badge variant="secondary"><Camera /> {detail.video_count > 0 && detail.photo_count === 0 ? 'Aberta por vídeo' : detail.video_count > 0 ? 'Aberta por mídia' : 'Aberta por foto'}</Badge>}</div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail.store || 'Loja pendente'} · recebida em {formatDate(detail.received_at)}</p>
          </div>
          {!finalized && <div className="hidden items-center gap-2 md:flex"><span className="mr-2 text-xs text-muted-foreground">{form.formState.isDirty ? 'Alterações não salvas' : 'Tudo salvo'}</span><Button type="submit" variant="outline" className="h-10" disabled={form.formState.isSubmitting || finalizing}>{form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />} Salvar</Button><Button type="button" className="h-10" disabled={blockingReasons.length > 0 || form.formState.isDirty || finalizing} onClick={finalize}>{finalizing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Finalizar</Button></div>}
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto border-t px-4 py-2 text-xs font-semibold text-muted-foreground sm:px-6" aria-label="Etapas da devolução">
          <Anchor href="#recebimento" label="1. Recebimento" />
          <Anchor href="#pacote" label="2. Pacote e pedido" />
          <Anchor href="#produtos" label="3. Produtos e condições" />
          <Anchor href="#finalizacao" label="4. Entrada e finalização" />
          <Anchor href="#historico" label="Histórico" />
        </nav>
      </header>

      <main className={cn('mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.35fr)] lg:items-start lg:py-8', embedded && 'min-h-0 flex-1 overflow-y-auto')}>
        <aside className={cn('min-w-0 lg:sticky', embedded ? 'lg:top-3' : 'lg:top-32')}>
          {detail.photos.length || detail.videos.length ? <Card className="overflow-hidden border-0 bg-card p-0 shadow-[0_14px_45px_rgb(28_39_36/8%)] ring-border/80"><ReturnPhotoGallery protocol={detail.protocol} photos={detail.photos} videos={detail.videos} returnId={detail.id} finalized={finalized} onVideosDeleted={refreshAfterVideoDeletion} /></Card> : <Card className="grid min-h-60 place-items-center border-dashed bg-card/60 text-center"><div><Camera className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm font-bold">Nenhuma foto ou vídeo recebido</p></div></Card>}
        </aside>

        <div className="min-w-0 space-y-5">
          <fieldset disabled={finalized} className="space-y-5">
            <SectionCard id="recebimento" step="1" icon={<MapPin />} title="Recebimento" description="Onde, de qual loja e quando a devolução chegou.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Local de recebimento" error={form.formState.errors.receivedLocation?.message}>
                  <NativeSelect className="w-full" {...form.register('receivedLocation')}><NativeSelectOption value="">Selecione</NativeSelectOption>{locationOptions.map((location) => <NativeSelectOption key={location.code} value={location.label}>{location.label}</NativeSelectOption>)}</NativeSelect>
                </Field>
                <Field label="Loja de origem" error={form.formState.errors.store?.message}>
                  <NativeSelect className="w-full" {...form.register('store')}><NativeSelectOption value="">Selecione</NativeSelectOption>{storeOptions.map((store) => <NativeSelectOption key={store.code} value={store.label}>{store.label}</NativeSelectOption>)}</NativeSelect>
                </Field>
                <Field label="Data e hora recebida" error={form.formState.errors.receivedAt?.message}><Input className="h-11" type="datetime-local" {...form.register('receivedAt')} /></Field>
              </div>
            </SectionCard>

            <SectionCard id="pacote" step="2" icon={<Truck />} title="Pacote e pedido" description="Identificação do pacote recebido e observações gerais.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ID do pedido"><Input className="h-11" placeholder="Número do pedido" {...form.register('orderId')} /></Field>
                <Field label="Código de rastreio"><Input className="h-11 uppercase" placeholder="Código da transportadora" {...form.register('trackingCode')} /></Field>
                <div className="sm:col-span-2"><Field label="Observações do pacote"><Textarea rows={3} placeholder="Estado da embalagem, etiqueta, lacre ou alguma informação importante..." {...form.register('notes')} /></Field></div>
              </div>
            </SectionCard>

            <SectionCard id="produtos" step="3" icon={<PackagePlus />} title="Produtos e condições" description="Classifique cada produto e defina o que deve ser feito.">
              <div className="mb-4 flex justify-end"><Button type="button" variant="outline" className="h-10" onClick={() => itemFields.append({ product: '', sku: '', quantity: 1, condition: '', conditionNotes: '', destination: '', testResult: '', notes: '' })}><PackagePlus /> Adicionar produto</Button></div>
              {itemFields.fields.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-muted/20 p-7 text-center"><Box className="mx-auto size-6 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">Nenhum produto informado</p><p className="mt-1 text-xs text-muted-foreground">Adicione os produtos para iniciar a classificação.</p></div>
              ) : (
                <div className="space-y-3">
                  {itemFields.fields.map((field, index) => {
                    const conditionCode = values.items?.[index]?.condition || '';
                    const conditionDefinition = options.conditions.find((condition) => condition.code === conditionCode);
                    return (
                      <div key={field.fieldKey} className="rounded-2xl border bg-muted/15 p-4">
                        <div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold">Produto {index + 1}</p><Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => itemFields.remove(index)} aria-label={`Remover produto ${index + 1}`}><Trash2 /></Button></div>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="sm:col-span-2"><Field label="Produto" error={form.formState.errors.items?.[index]?.product?.message}><Input className="h-11" placeholder="Nome ou descrição" {...form.register(`items.${index}.product`)} /></Field></div>
                          <Field label="SKU"><Input className="h-11" {...form.register(`items.${index}.sku`)} /></Field>
                          <Field label="Quantidade" error={form.formState.errors.items?.[index]?.quantity?.message}><Input className="h-11" type="number" min={1} inputMode="numeric" {...form.register(`items.${index}.quantity`, { valueAsNumber: true })} /></Field>
                          <Field label="Condição do produto">
                            <NativeSelect className="w-full" {...form.register(`items.${index}.condition`)}><NativeSelectOption value="">Selecione</NativeSelectOption>{options.conditions.map((condition) => <NativeSelectOption key={condition.code} value={condition.code}>{condition.label}{condition.requires_invoice ? '' : ' · sem nota'}</NativeSelectOption>)}</NativeSelect>
                          </Field>
                          <Field label="Destino / ação">
                            <NativeSelect className="w-full" {...form.register(`items.${index}.destination`, { onChange: (event) => { if (event.target.value === 'TEST') form.setValue('status', 'WAITING_TEST', { shouldDirty: true }); } })}><NativeSelectOption value="">Selecione</NativeSelectOption>{destinationOptions.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect>
                          </Field>
                          <div className="sm:col-span-2"><Field label="Condições encontradas" hint={conditionDefinition?.requires_notes ? 'Obrigatório' : 'Opcional'}><Textarea rows={2} placeholder="Descreva defeitos, riscos, avarias ou faltas..." {...form.register(`items.${index}.conditionNotes`)} /></Field></div>
                          {values.items?.[index]?.destination === 'TEST' && <div className="sm:col-span-2 lg:col-span-4"><Field label="Resultado do teste"><Textarea rows={2} placeholder="Registre o teste realizado e o resultado..." {...form.register(`items.${index}.testResult`)} /></Field></div>}
                        </div>
                        {conditionDefinition && !conditionDefinition.requires_invoice && <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"><CheckCircle2 className="size-4" /> Esta condição dispensa nota de entrada.</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard id="finalizacao" step="4" icon={<FileCheck2 />} title="Entrada e finalização" description="Defina o status e conclua somente quando as regras estiverem atendidas.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status operacional" htmlFor="return-status">
                  <StatusSelect value={values.status || ''} statuses={statuses.filter((status) => (status.code !== 'FINALIZED' || finalized) && (Boolean(status.active) || status.code === detail.status))} onChange={(status) => form.setValue('status', status, { shouldDirty: true, shouldValidate: true })} />
                </Field>
                <Field label={allItemsInvoiceExempt ? 'Nota de entrada' : 'Número da nota de entrada'} hint={allItemsInvoiceExempt ? 'Dispensada pelas condições' : 'Obrigatória para finalizar'}><Input className="h-11" placeholder={allItemsInvoiceExempt ? 'Não necessária' : 'Informe o número'} {...form.register('invoiceNumber')} /></Field>
                <Field label="Data da entrada"><Input className="h-11" type="date" {...form.register('invoiceDate')} /></Field>
              </div>

              {blockingReasons.length > 0 && (
                <Alert className="mt-5 border-amber-200 bg-amber-50 text-amber-900"><AlertCircle /><AlertTitle>Falta concluir {blockingReasons.length === 1 ? '1 item' : `${blockingReasons.length} itens`}</AlertTitle><AlertDescription><ul className="mt-1 list-disc space-y-1 pl-4">{blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></AlertDescription></Alert>
              )}
            </SectionCard>
          </fieldset>

          {finalized && <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900"><CheckCircle2 /><AlertTitle>Devolução finalizada</AlertTitle><AlertDescription>Finalizada por {detail.finalized_by} em {formatDate(detail.finalized_at)}. O registro está protegido contra edições.</AlertDescription></Alert>}

          {!finalized && (
            <Card className="border-0 bg-card p-4 shadow-[0_12px_38px_rgb(28_39_36/7%)] ring-border/80 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{form.formState.isDirty ? 'Há alterações ainda não salvas.' : blockingReasons.length ? 'Salve os dados e conclua as pendências indicadas.' : 'Tudo pronto para finalizar.'}</p><div className="flex flex-col gap-2 sm:flex-row"><Button type="submit" variant="outline" className="h-11" disabled={form.formState.isSubmitting || finalizing}>{form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />} Salvar alterações</Button><Button type="button" className="h-11" disabled={blockingReasons.length > 0 || form.formState.isDirty || finalizing} onClick={finalize}>{finalizing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Finalizar devolução</Button></div></div>
            </Card>
          )}

          <SectionCard id="historico" icon={<History />} title="Histórico" description="Registro das principais alterações desta devolução.">
            <div className="space-y-3">{detail.history.map((event) => <div key={event.id} className="flex gap-3 text-sm"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/50" /><div><p className="font-medium">{historyLabel(event.action)}</p><p className="text-xs text-muted-foreground">{event.actor} · {formatDate(event.created_at)}</p></div></div>)}</div>
          </SectionCard>

          {serverError && <Alert variant="destructive"><AlertCircle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{serverError}</AlertDescription></Alert>}
        </div>
      </main>
      {notice && <output className="fixed bottom-5 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-xl">{notice}</output>}
    </form>
  );
}

function StatusSelect({ value, statuses, onChange }: { value: string; statuses: StatusDefinition[]; onChange: (value: string) => void }) {
  const selected = statuses.find((status) => status.code === value);
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger id="return-status" className="h-11 w-full rounded-xl"><span className="flex min-w-0 flex-1 items-center gap-2 text-left">{selected ? <><span className="size-2.5 shrink-0 rounded-full" style={statusDotStyle(selected.color)} /><span className="truncate">{selected.label}</span></> : <span className="text-muted-foreground">Status não configurado</span>}</span></SelectTrigger>
      <SelectContent>
        {statuses.map((status) => <SelectItem key={status.code} value={status.code}><span className="size-2.5 rounded-full" style={statusDotStyle(status.color)} />{status.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function SectionCard({ id, step, icon, title, description, children }: { id: string; step?: string; icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <Card id={id} className="scroll-mt-32 border-0 bg-card p-5 shadow-[0_12px_38px_rgb(28_39_36/7%)] ring-border/80 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-5">{step || icon}</span><div>{step && <span className="sr-only">{icon}</span>}<h2 className="font-bold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div><div className="mt-5">{children}</div></Card>;
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2"><Label htmlFor={htmlFor}>{label}</Label>{hint && <span className="text-[11px] font-medium text-muted-foreground">{hint}</span>}</div>{children}{error && <p className="text-xs text-destructive">{error}</p>}</div>;
}

function Anchor({ href, label }: { href: string; label: string }) {
  return <a href={href} className="shrink-0 rounded-lg px-3 py-1.5 hover:bg-muted hover:text-foreground">{label}</a>;
}

function mergeCurrentOption(options: ConfigOption[], current: string | null) {
  if (!current || options.some((option) => option.label === current)) return options;
  return [...options, { code: `CURRENT_${current}`, type: 'STORE', label: current, color: '#64748b', is_system: 0, sort_order: 999, active: 1, requires_invoice: 1, requires_notes: 0 } as ConfigOption];
}

function formatDate(value: string | null) {
  if (!value) return 'data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function historyLabel(action: string) {
  const labels: Record<string, string> = { CREATED: 'Devolução registrada', UPDATED: 'Informações atualizadas', FINALIZED: 'Devolução finalizada', VIDEOS_DELETION_PENDING: 'Vídeos removidos; limpeza do espaço pendente', VIDEOS_DELETED: 'Vídeos excluídos para liberar espaço' };
  return labels[action] || action;
}
