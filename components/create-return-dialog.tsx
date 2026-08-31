'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Camera, CheckCircle2, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { createReturnSchema, type ReturnDetail } from '@/lib/returns';

type CreateInput = z.input<typeof createReturnSchema>;
type CreateOutput = z.output<typeof createReturnSchema>;

function currentLocalDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const defaults = (): CreateInput => ({
  source: 'PHOTO',
  store: '',
  receivedLocation: 'Escritório de São Paulo',
  receivedAt: currentLocalDateTime(),
  orderId: '',
  trackingCode: '',
  notes: '',
  product: '',
  quantity: 1,
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (item: ReturnDetail) => void;
  onView: (id: string) => void;
};

export function CreateReturnDialog({ open, onOpenChange, onCreated, onView }: Props) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState<{ item: ReturnDetail; duplicates: Array<{ id: string; protocol: string }> } | null>(null);
  const form = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(createReturnSchema),
    defaultValues: defaults(),
  });
  const source = form.watch('source');
  const previews = useMemo(
    () => photos.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [photos],
  );

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  function resetForm() {
    setPhotos([]);
    setServerError('');
    setSuccess(null);
    form.reset(defaults());
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !form.formState.isSubmitting) resetForm();
    onOpenChange(nextOpen);
  }

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const next = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    setPhotos((current) => [...current, ...next].slice(0, 8));
    setServerError('');
  }

  async function submit(data: CreateOutput) {
    setServerError('');
    if (data.source === 'PHOTO' && photos.length === 0) {
      setServerError('Tire ou selecione pelo menos uma foto.');
      return;
    }
    if (data.source === 'MANUAL' && !data.product.trim()) {
      setServerError('Informe pelo menos um produto no cadastro completo.');
      return;
    }
    if (data.source === 'MANUAL' && !data.orderId.trim() && !data.trackingCode.trim()) {
      setServerError('Informe o ID do pedido ou o código de rastreio.');
      return;
    }

    const payload = new FormData();
    Object.entries(data).forEach(([key, value]) => payload.append(key, String(value ?? '')));
    const parsedDate = new Date(data.receivedAt);
    payload.set('receivedAt', Number.isNaN(parsedDate.getTime()) ? data.receivedAt : parsedDate.toISOString());
    photos.forEach((photo) => payload.append('photos', photo));

    try {
      const response = await fetch('/api/returns', { method: 'POST', body: payload });
      const result = (await response.json()) as {
        item?: ReturnDetail;
        duplicates?: Array<{ id: string; protocol: string }>;
        error?: string;
      };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível registrar a devolução.');
      const nextSuccess = { item: result.item, duplicates: result.duplicates || [] };
      setSuccess(nextSuccess);
      onCreated(result.item);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível registrar a devolução.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-1rem)] overflow-y-auto p-0 sm:max-w-2xl">
        {success ? (
          <div className="p-6 sm:p-8">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-7" />
            </div>
            <div className="mt-4 text-center">
              <DialogTitle className="text-xl font-bold">Recebimento registrado</DialogTitle>
              <DialogDescription className="mx-auto mt-2 max-w-md">
                A devolução <strong className="text-foreground">{success.item.protocol}</strong> já está disponível para triagem.
              </DialogDescription>
            </div>
            {success.duplicates.length > 0 && (
              <Alert className="mt-5 border-amber-200 bg-amber-50 text-amber-900">
                <AlertCircle />
                <AlertTitle>Possível duplicidade</AlertTitle>
                <AlertDescription>
                  Encontramos o mesmo pedido ou rastreio em {success.duplicates.map((item) => item.protocol).join(', ')}. O novo registro foi mantido.
                </AlertDescription>
              </Alert>
            )}
            <div className="mt-7 grid gap-2 sm:grid-cols-2">
              <Button variant="outline" className="h-11" onClick={resetForm}>Registrar outra</Button>
              <Button className="h-11" onClick={() => { onView(success.item.id); handleOpenChange(false); }}>Ver devolução</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(submit)}>
            <DialogHeader className="border-b px-5 pb-4 pt-5 pr-12">
              <DialogTitle className="text-lg font-bold">Registrar recebimento</DialogTitle>
              <DialogDescription>Abra o protocolo agora. Os dados podem ser completados depois.</DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-5 py-5">
              <Tabs value={source} onValueChange={(value) => form.setValue('source', value as 'PHOTO' | 'MANUAL')}>
                <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl">
                  <TabsTrigger value="PHOTO" className="h-9"><Camera /> Rápido por foto</TabsTrigger>
                  <TabsTrigger value="MANUAL" className="h-9"><ImagePlus /> Cadastro completo</TabsTrigger>
                </TabsList>
              </Tabs>

              <div>
                <Label htmlFor="return-photos">Fotos da devolução {source === 'PHOTO' && <span className="text-destructive">*</span>}</Label>
                <label
                  htmlFor="return-photos"
                  className="mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/25 bg-primary/[0.035] p-4 text-center transition hover:border-primary/45 hover:bg-primary/[0.06]"
                >
                  <Camera className="size-6 text-primary" />
                  <span className="mt-2 text-sm font-semibold">Tirar ou selecionar fotos</span>
                  <span className="mt-1 text-xs text-muted-foreground">Até 8 imagens, 10 MB cada</span>
                </label>
                <input
                  id="return-photos"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={(event) => { addPhotos(event.target.files); event.target.value = ''; }}
                />
                {previews.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {previews.map(({ file, url }, index) => (
                      <div key={`${file.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl border bg-muted">
                        {/* Blob previews are local-only and cannot use the image optimizer. */}
                        {/* eslint-disable-next-line next/no-img-element */}
                        <img src={url} alt={`Prévia ${index + 1}: ${file.name}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label={`Remover ${file.name}`}
                          className="absolute right-1 top-1 grid size-7 place-items-center rounded-lg bg-black/65 text-white"
                          onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Local de recebimento" error={form.formState.errors.receivedLocation?.message}>
                  <Input className="h-11" {...form.register('receivedLocation')} />
                </Field>
                <Field label="Data e hora recebida" error={form.formState.errors.receivedAt?.message}>
                  <Input className="h-11" type="datetime-local" {...form.register('receivedAt')} />
                </Field>
                <Field label="Loja / canal" hint={source === 'PHOTO' ? 'Opcional agora' : undefined}>
                  <Input className="h-11" placeholder="Ex.: Mercado Livre" {...form.register('store')} />
                </Field>
                <Field label="ID do pedido" hint={source === 'PHOTO' ? 'Opcional agora' : undefined}>
                  <Input className="h-11" placeholder="Ex.: 200000123456" {...form.register('orderId')} />
                </Field>
                <Field label="Código de rastreio" hint={source === 'PHOTO' ? 'Opcional agora' : undefined}>
                  <Input className="h-11 uppercase" placeholder="Ex.: AB123456789BR" {...form.register('trackingCode')} />
                </Field>
                {source === 'MANUAL' && (
                  <>
                    <Field label="Produto" error={form.formState.errors.product?.message}>
                      <Input className="h-11" placeholder="Nome ou SKU do produto" {...form.register('product')} />
                    </Field>
                    <Field label="Quantidade" error={form.formState.errors.quantity?.message}>
                      <Input className="h-11" type="number" min={1} inputMode="numeric" {...form.register('quantity')} />
                    </Field>
                  </>
                )}
              </div>

              <Field label="Observação" hint="Opcional">
                <Textarea rows={3} placeholder="Estado da embalagem, informações recebidas ou algo importante..." {...form.register('notes')} />
              </Field>

              {serverError && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Não foi possível continuar</AlertTitle>
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="sticky bottom-0">
              <Button type="button" variant="outline" className="h-11" onClick={() => handleOpenChange(false)} disabled={form.formState.isSubmitting}>Cancelar</Button>
              <Button type="submit" className="h-11 min-w-44" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <><Loader2 className="animate-spin" /> Enviando...</> : <><CheckCircle2 /> Registrar devolução</>}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
