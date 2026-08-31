'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  Box,
  Camera,
  CheckCircle2,
  FileCheck2,
  History,
  Loader2,
  PackagePlus,
  Save,
  Trash2,
} from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  conditionOptions,
  destinationOptions,
  getBlockingReasons,
  updateReturnSchema,
  type ReturnDetail,
  type StatusDefinition,
} from '@/lib/returns';

type UpdateInput = z.input<typeof updateReturnSchema>;
type UpdateOutput = z.output<typeof updateReturnSchema>;

type Props = {
  open: boolean;
  returnId: string | null;
  statuses: StatusDefinition[];
  onOpenChange: (open: boolean) => void;
  onChanged: (item: ReturnDetail) => void;
};

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

export function ReturnDetailSheet({ open, returnId, statuses, onOpenChange, onChanged }: Props) {
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
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
  const blockingReasons = useMemo(
    () =>
      getBlockingReasons({
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
      }),
    [values],
  );

  useEffect(() => {
    if (!open || !returnId) return;
    let cancelled = false;
    setLoading(true);
    setServerError('');
    fetch(`/api/returns/${returnId}`)
      .then(async (response) => {
        const result = (await response.json()) as { item?: ReturnDetail; error?: string };
        if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível abrir a devolução.');
        return result.item;
      })
      .then((item) => {
        if (cancelled) return;
        setDetail(item);
        form.reset(mapDetail(item));
      })
      .catch((error) => !cancelled && setServerError(error instanceof Error ? error.message : 'Não foi possível abrir a devolução.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [form, open, returnId]);

  async function save(data: UpdateOutput) {
    if (!returnId) return;
    setServerError('');
    const payload = {
      ...data,
      receivedAt: (() => {
        const date = new Date(data.receivedAt);
        return Number.isNaN(date.getTime()) ? data.receivedAt : date.toISOString();
      })(),
    };
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
      onChanged(result.item);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível salvar.');
    }
  }

  async function finalize() {
    if (!returnId || !detail) return;
    if (!window.confirm(`Finalizar ${detail.protocol}? Depois disso, o registro ficará bloqueado para edição.`)) return;
    setFinalizing(true);
    setServerError('');
    try {
      const response = await fetch(`/api/returns/${returnId}/finalize`, { method: 'POST' });
      const result = (await response.json()) as { item?: ReturnDetail; error?: string; details?: { blockingReasons?: string[] } };
      if (!response.ok || !result.item) {
        throw new Error(result.details?.blockingReasons?.join(' ') || result.error || 'Não foi possível finalizar.');
      }
      setDetail(result.item);
      form.reset(mapDetail(result.item));
      onChanged(result.item);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível finalizar.');
    } finally {
      setFinalizing(false);
    }
  }

  const finalized = detail?.status === 'FINALIZED';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[960px]" aria-describedby="return-detail-description">
        {loading ? (
          <div className="grid h-full place-items-center text-muted-foreground">
            <div className="text-center"><Loader2 className="mx-auto size-6 animate-spin" /><p className="mt-2 text-sm">Abrindo devolução...</p></div>
          </div>
        ) : detail ? (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(save)}>
            <SheetHeader className="border-b px-5 py-4 pr-12 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-lg font-bold">{detail.protocol}</SheetTitle>
                <Badge variant="outline" className={statusClasses[detail.status_color] || statusClasses.slate}>{detail.status_label}</Badge>
                {detail.source === 'PHOTO' && <Badge variant="secondary"><Camera /> Aberta por foto</Badge>}
              </div>
              <SheetDescription id="return-detail-description">
                Recebida em {formatDate(detail.received_at)} · {detail.received_location}
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <fieldset disabled={finalized} className="space-y-7 px-5 py-6 sm:px-6">
                {detail.photos.length > 0 && (
                  <section>
                    <SectionTitle icon={<Camera />} title={`Fotos recebidas (${detail.photos.length})`} />
                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {detail.photos.map((photo, index) => (
                        <a key={photo.id} href={`/api/photos/${photo.id}`} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-xl border bg-muted">
                          {/* Private photos are streamed by an authenticated application route. */}
                          {/* eslint-disable-next-line next/no-img-element */}
                          <img src={`/api/photos/${photo.id}`} alt={`Foto ${index + 1} da devolução ${detail.protocol}`} className="h-full w-full object-cover transition group-hover:scale-105" />
                        </a>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <SectionTitle icon={<Box />} title="Dados da devolução" />
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Loja / canal" error={form.formState.errors.store?.message}><Input className="h-11" {...form.register('store')} /></Field>
                    <Field label="Local de recebimento" error={form.formState.errors.receivedLocation?.message}><Input className="h-11" {...form.register('receivedLocation')} /></Field>
                    <Field label="Data recebida" error={form.formState.errors.receivedAt?.message}><Input className="h-11" type="datetime-local" {...form.register('receivedAt')} /></Field>
                    <Field label="ID do pedido"><Input className="h-11" {...form.register('orderId')} /></Field>
                    <Field label="Código de rastreio"><Input className="h-11 uppercase" {...form.register('trackingCode')} /></Field>
                    <Field label="Status operacional">
                      <NativeSelect className="w-full" {...form.register('status')}>
                        {statuses.filter((status) => status.code !== 'FINALIZED').map((status) => <NativeSelectOption key={status.code} value={status.code}>{status.label}</NativeSelectOption>)}
                      </NativeSelect>
                    </Field>
                    <div className="sm:col-span-2 lg:col-span-3"><Field label="Observação geral"><Textarea rows={3} {...form.register('notes')} /></Field></div>
                  </div>
                </section>

                <Separator />

                <section>
                  <div className="flex items-center justify-between gap-3">
                    <SectionTitle icon={<PackagePlus />} title={`Produtos (${itemFields.fields.length})`} />
                    {!finalized && (
                      <Button type="button" variant="outline" className="h-10" onClick={() => itemFields.append({ product: '', sku: '', quantity: 1, condition: '', conditionNotes: '', destination: '', testResult: '', notes: '' })}>
                        <PackagePlus /> Adicionar produto
                      </Button>
                    )}
                  </div>
                  {itemFields.fields.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-dashed bg-muted/30 p-6 text-center">
                      <Box className="mx-auto size-6 text-muted-foreground" />
                      <p className="mt-2 text-sm font-semibold">Nenhum produto informado</p>
                      <p className="mt-1 text-xs text-muted-foreground">Adicione os itens para iniciar a classificação.</p>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {itemFields.fields.map((field, index) => {
                        const condition = values.items?.[index]?.condition;
                        return (
                          <div key={field.fieldKey} className="rounded-2xl border bg-card p-4 shadow-xs">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="text-sm font-bold">Produto {index + 1}</p>
                              {!finalized && <Button type="button" variant="ghost" size="icon" aria-label={`Remover produto ${index + 1}`} className="text-destructive" onClick={() => itemFields.remove(index)}><Trash2 /></Button>}
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                              <div className="sm:col-span-2"><Field label="Produto" error={form.formState.errors.items?.[index]?.product?.message}><Input className="h-11" {...form.register(`items.${index}.product`)} /></Field></div>
                              <Field label="SKU"><Input className="h-11" {...form.register(`items.${index}.sku`)} /></Field>
                              <Field label="Quantidade" error={form.formState.errors.items?.[index]?.quantity?.message}><Input className="h-11" type="number" min={1} inputMode="numeric" {...form.register(`items.${index}.quantity`, { valueAsNumber: true })} /></Field>
                              <Field label="Condição">
                                <NativeSelect className="w-full" {...form.register(`items.${index}.condition`)}>
                                  <NativeSelectOption value="">Selecione</NativeSelectOption>
                                  {conditionOptions.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
                                </NativeSelect>
                              </Field>
                              <Field label="Destino / ação">
                                <NativeSelect
                                  className="w-full"
                                  {...form.register(`items.${index}.destination`, {
                                    onChange: (event) => {
                                      if (event.target.value === 'TEST') form.setValue('status', 'WAITING_TEST', { shouldDirty: true });
                                    },
                                  })}
                                >
                                  <NativeSelectOption value="">Selecione</NativeSelectOption>
                                  {destinationOptions.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
                                </NativeSelect>
                              </Field>
                              <div className="sm:col-span-2"><Field label="Condições encontradas" hint={['DEFECTIVE', 'DAMAGED', 'INCOMPLETE', 'OTHER'].includes(condition || '') ? 'Obrigatório' : undefined}><Textarea rows={2} placeholder="Descreva riscos, avarias, faltas ou defeitos..." {...form.register(`items.${index}.conditionNotes`)} /></Field></div>
                              {values.items?.[index]?.destination === 'TEST' && <div className="sm:col-span-2 lg:col-span-4"><Field label="Resultado do teste"><Textarea rows={2} placeholder="Registre o que foi testado e o resultado..." {...form.register(`items.${index}.testResult`)} /></Field></div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <Separator />

                <section>
                  <SectionTitle icon={<FileCheck2 />} title="Entrada no sistema" />
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Número da nota de entrada"><Input className="h-11" placeholder="Obrigatório para finalizar" {...form.register('invoiceNumber')} /></Field>
                    <Field label="Data da entrada"><Input className="h-11" type="date" {...form.register('invoiceDate')} /></Field>
                  </div>
                </section>

                {blockingReasons.length > 0 && !finalized && (
                  <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                    <AlertCircle />
                    <AlertTitle>Falta concluir {blockingReasons.length === 1 ? '1 item' : `${blockingReasons.length} itens`}</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">{blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    </AlertDescription>
                  </Alert>
                )}

                {finalized && (
                  <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                    <CheckCircle2 />
                    <AlertTitle>Devolução finalizada</AlertTitle>
                    <AlertDescription>Finalizada por {detail.finalized_by} em {formatDate(detail.finalized_at)}. O registro está protegido contra edições.</AlertDescription>
                  </Alert>
                )}

                <section>
                  <SectionTitle icon={<History />} title="Histórico" />
                  <div className="mt-3 space-y-3">
                    {detail.history.map((event) => (
                      <div key={event.id} className="flex gap-3 text-sm">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/50" />
                        <div><p className="font-medium">{historyLabel(event.action)}</p><p className="text-xs text-muted-foreground">{event.actor} · {formatDate(event.created_at)}</p></div>
                      </div>
                    ))}
                  </div>
                </section>
              </fieldset>
            </div>

            {!finalized && (
              <SheetFooter className="border-t bg-card/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs text-muted-foreground">
                  {form.formState.isDirty ? 'Há alterações ainda não salvas.' : blockingReasons.length ? 'Salve a triagem; o sistema avisará o que falta.' : 'Tudo pronto para finalizar.'}
                </p>
                <div className="flex gap-2">
                  <Button type="submit" variant="outline" className="h-11" disabled={form.formState.isSubmitting || finalizing}>
                    {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />} Salvar alterações
                  </Button>
                  <Button type="button" className="h-11" disabled={blockingReasons.length > 0 || form.formState.isDirty || finalizing} onClick={finalize}>
                    {finalizing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Finalizar devolução
                  </Button>
                </div>
              </SheetFooter>
            )}
          </form>
        ) : (
          <div className="grid h-full place-items-center p-6">
            <Alert variant="destructive"><AlertCircle /><AlertTitle>Não foi possível abrir</AlertTitle><AlertDescription>{serverError || 'Tente novamente.'}</AlertDescription></Alert>
          </div>
        )}
        {serverError && detail && <div className="absolute bottom-24 left-5 right-5 z-10"><Alert variant="destructive" className="shadow-lg"><AlertCircle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{serverError}</AlertDescription></Alert></div>}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><div className="flex items-center justify-between"><Label>{label}</Label>{hint && <span className="text-[11px] font-medium text-amber-700">{hint}</span>}</div>{children}{error && <p className="text-xs text-destructive">{error}</p>}</div>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="flex items-center gap-2 text-sm font-bold text-foreground [&>svg]:size-[18px] [&>svg]:text-primary">{icon}{title}</div>;
}

function formatDate(value: string | null) {
  if (!value) return 'data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function historyLabel(action: string) {
  const labels: Record<string, string> = { CREATED: 'Devolução registrada', UPDATED: 'Informações atualizadas', FINALIZED: 'Devolução finalizada' };
  return labels[action] || action;
}
