'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Loader2,
  MapPin,
  PackageCheck,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';

import { ContinuousCamera } from '@/components/continuous-camera';
import { PhotoLightbox } from '@/components/photo-lightbox';
import { TinyProductInput } from '@/components/tiny-product-input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { UserMenu } from '@/components/user-menu';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth';
import { MAX_PHOTO_BYTES, normalizeImageFile } from '@/lib/client-images';
import { formatVideoDuration, formatVideoSize, prepareVideoFile, type PreparedVideo } from '@/lib/client-video';
import { hasUserPermission } from '@/lib/permissions';
import type { ConfigOptionsResponse, ReturnDetail } from '@/lib/returns';
import { statusDotStyle } from '@/lib/status-colors';

type ReceiptFields = {
  receivedLocation: string;
  receivedAt: string;
  store: string;
  orderId: string;
  trackingCode: string;
  product: string;
  quantity: string;
  notes: string;
};

function currentLocalDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function defaultFields(): ReceiptFields {
  return {
    receivedLocation: 'Escritório de São Paulo',
    receivedAt: currentLocalDateTime(),
    store: '',
    orderId: '',
    trackingCode: '',
    product: '',
    quantity: '1',
    notes: '',
  };
}

export function MobileReceiptPage({ currentUser }: { currentUser: AuthUser }) {
  const canViewReturns = hasUserPermission(currentUser, 'returns.view');
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const videoCameraInput = useRef<HTMLInputElement>(null);
  const videoGalleryInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [video, setVideo] = useState<PreparedVideo | null>(null);
  const [options, setOptions] = useState<ConfigOptionsResponse>({ locations: [], stores: [], conditions: [] });
  const [fields, setFields] = useState<ReceiptFields>(defaultFields);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preparingPhotos, setPreparingPhotos] = useState('');
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{
    item: ReturnDetail;
    duplicates: Array<{ id: string; protocol: string }>;
  } | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

  const previews = useMemo(
    () => photos.map((file, index) => ({
      file,
      url: URL.createObjectURL(file),
      alt: `Prévia da foto ${index + 1}: ${file.name}`,
    })),
    [photos],
  );
  const videoPreviewUrl = useMemo(() => video ? URL.createObjectURL(video.file) : '', [video]);

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);
  useEffect(() => () => { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); }, [videoPreviewUrl]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/config/options')
      .then(async (response) => {
        const result = (await response.json()) as ConfigOptionsResponse;
        if (!response.ok) throw new Error('Não foi possível carregar locais e lojas.');
        return result;
      })
      .then((result) => {
        if (cancelled) return;
        setOptions(result);
        setFields((current) => ({
          ...current,
          receivedLocation: result.locations.some((item) => item.label === current.receivedLocation)
            ? current.receivedLocation
            : result.locations[0]?.label || current.receivedLocation,
        }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  function updateField(name: keyof ReceiptFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const available = Math.max(0, 8 - photos.length);
    const incoming = Array.from(fileList).slice(0, available);
    if (!incoming.length) {
      setError('É possível registrar até 8 fotos por devolução.');
      return;
    }
    const prepared: File[] = [];
    const failures: string[] = [];
    try {
      for (let index = 0; index < incoming.length; index += 1) {
        setPreparingPhotos(`Otimizando foto ${index + 1} de ${incoming.length}…`);
        try {
          prepared.push(await normalizeImageFile(incoming[index]));
        } catch (photoError) {
          failures.push(photoError instanceof Error ? photoError.message : `${incoming[index].name}: não foi possível preparar.`);
        }
      }
      setPhotos((current) => [...current, ...prepared].slice(0, 8));
      setError(failures.join(' '));
    } finally {
      setPreparingPhotos('');
    }
  }

  function addCapturedPhoto(file: File) {
    if (!file.type.startsWith('image/') || file.size > MAX_PHOTO_BYTES) {
      setError('A foto capturada não pôde ser adicionada. Use a câmera do aparelho como alternativa.');
      return;
    }
    setPhotos((current) => current.length >= 8 ? current : [...current, file]);
    setError('');
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
    setError('');
  }

  async function addVideo(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setPreparingVideo(true);
    setError('');
    try {
      setVideo(await prepareVideoFile(file));
    } catch (videoError) {
      setError(videoError instanceof Error ? videoError.message : 'Não foi possível preparar o vídeo.');
    } finally {
      setPreparingVideo(false);
    }
  }

  function removeVideo() {
    setVideo(null);
    setError('');
  }

  function reset() {
    setPhotos([]);
    setVideo(null);
    setFields(defaultFields());
    setDetailsOpen(false);
    setError('');
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (photos.length === 0 && !video) {
      setError('Tire uma foto ou grave um vídeo para registrar a devolução.');
      return;
    }
    if (!fields.receivedLocation.trim()) {
      setError('Informe o local de recebimento.');
      setDetailsOpen(true);
      return;
    }

    setSubmitting(true);
    setError('');
    const payload = new FormData();
    payload.set('source', 'PHOTO');
    payload.set('receivedLocation', fields.receivedLocation);
    const receivedDate = new Date(fields.receivedAt);
    payload.set('receivedAt', Number.isNaN(receivedDate.getTime()) ? fields.receivedAt : receivedDate.toISOString());
    payload.set('store', fields.store);
    payload.set('orderId', fields.orderId);
    payload.set('trackingCode', fields.trackingCode);
    payload.set('product', fields.product);
    payload.set('quantity', fields.quantity || '1');
    payload.set('notes', fields.notes);
    photos.forEach((photo) => payload.append('photos', photo));
    if (video) {
      payload.append('videos', video.file);
      payload.set('videoDurationMs', String(video.durationMs));
    }

    try {
      const response = await apiFetch('/api/returns', { method: 'POST', body: payload });
      const result = (await response.json()) as {
        item?: ReturnDetail;
        duplicates?: Array<{ id: string; protocol: string }>;
        error?: string;
      };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível registrar a devolução.');
      setSuccess({ item: result.item, duplicates: result.duplicates || [] });
      setPhotos([]);
      setVideo(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível registrar a devolução.');
    } finally {
      setSubmitting(false);
    }
  }

  const viewerPhotos = previews.map((preview, index) => ({
    src: preview.url,
    alt: preview.alt,
    label: `Foto ${index + 1} antes do envio`,
  }));
  const mediaCount = photos.length + (video ? 1 : 0);

  if (success) {
    return (
      <main className="min-h-[100dvh] bg-background px-4 py-8 sm:grid sm:place-items-center">
        <section className="mx-auto w-full max-w-lg rounded-3xl border bg-card p-6 text-center shadow-[0_18px_60px_rgb(28_39_36/10%)] sm:p-8">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="size-8" />
          </div>
          <p className="mt-5 text-sm font-semibold text-primary">Recebimento concluído</p>
          <h1 className="display-title mt-1 text-2xl">{success.item.protocol} registrada</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Foram enviados {success.item.photo_count} {success.item.photo_count === 1 ? 'foto' : 'fotos'} e {success.item.video_count} {success.item.video_count === 1 ? 'vídeo' : 'vídeos'}. A devolução já está disponível para triagem no computador.</p>

          {success.duplicates.length > 0 && (
            <Alert className="mt-5 border-amber-200 bg-amber-50 text-left text-amber-900">
              <AlertCircle />
              <AlertTitle>Possível duplicidade</AlertTitle>
              <AlertDescription>
                O mesmo pedido ou rastreio aparece em {success.duplicates.map((item) => item.protocol).join(', ')}. O novo registro foi mantido.
              </AlertDescription>
            </Alert>
          )}

          <div className={`mt-7 grid gap-3 ${canViewReturns ? 'sm:grid-cols-2' : ''}`}>
            {canViewReturns && <Button variant="outline" className="h-12 rounded-xl" onClick={() => { window.location.href = '/'; }}>
              Voltar às pendências
            </Button>}
            <Button className="h-12 rounded-xl" onClick={reset}>
              <Camera /> Registrar outra
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell min-h-[100dvh] text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:px-6">
          {canViewReturns && <Link href="/" className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Voltar às pendências">
            <ArrowLeft className="size-5" />
          </Link>}
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <PackageCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold">Nova devolução</h1>
            <p className="truncate text-xs text-muted-foreground">Recebimento rápido por foto ou vídeo</p>
          </div>
          <div className="ml-auto"><UserMenu user={currentUser} /></div>
        </div>
      </header>

      <form onSubmit={submit} className="mx-auto max-w-3xl pb-32">
        <div className="space-y-5 px-4 py-6 sm:px-6 sm:py-8">
          <section>
            <p className="text-sm font-semibold text-primary">Passo principal</p>
            <h2 className="display-title mt-1 text-2xl">Fotografe ou grave a devolução</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Registre a etiqueta, a embalagem e o produto. Você pode adicionar até 8 fotos e 1 vídeo curto; os outros dados podem ser preenchidos depois no computador.
            </p>
          </section>

          <section className="grid gap-4 rounded-3xl border border-primary/20 bg-primary/[0.035] p-4 shadow-sm sm:grid-cols-2 sm:p-5" aria-label="Identificação rápida do recebimento">
            <div className="sm:col-span-2">
              <p className="text-sm font-bold">Identifique antes de fotografar</p>
              <p className="mt-1 text-xs text-muted-foreground">No celular, os campos de seleção ficam primeiro para agilizar a bipagem.</p>
            </div>
            <Field label="Local de recebimento" htmlFor="receipt-location">
              <NativeSelect id="receipt-location" className="h-12 w-full bg-card" value={fields.receivedLocation} onChange={(event) => updateField('receivedLocation', event.target.value)}>
                <NativeSelectOption value="">Selecione o local</NativeSelectOption>
                {options.locations.map((location) => <NativeSelectOption key={location.code} value={location.label}>{location.label}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field label="Loja / canal" htmlFor="receipt-store" hint="Opcional">
              <Select value={fields.store} onValueChange={(value) => updateField('store', value || '')}>
                <SelectTrigger id="receipt-store" className="h-12 w-full rounded-xl bg-card"><span className="flex min-w-0 flex-1 items-center gap-2 text-left">{fields.store ? <><span className="size-3 shrink-0 rounded-full ring-4 ring-background" style={statusDotStyle(options.stores.find((store) => store.label === fields.store)?.color || '#64748b')} /><span className="truncate font-medium">{fields.store}</span></> : <span className="text-muted-foreground">Selecionar loja</span>}</span></SelectTrigger>
                <SelectContent>{options.stores.map((store) => <SelectItem key={store.code} value={store.label}><span className="size-3 rounded-full ring-2 ring-background" style={statusDotStyle(store.color)} />{store.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </section>

          <section className="grid gap-3 sm:grid-cols-2" aria-label="Adicionar fotos">
            <ContinuousCamera
              disabled={photos.length >= 8 || submitting || Boolean(preparingPhotos)}
              photoCount={photos.length}
              previews={previews}
              onCapture={addCapturedPhoto}
              onNativeFallback={() => cameraInput.current?.click()}
            />
            <button
              type="button"
              onClick={() => galleryInput.current?.click()}
              disabled={photos.length >= 8 || submitting || Boolean(preparingPhotos)}
              className="flex min-h-28 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-primary/25 bg-card px-5 py-5 text-center outline-none transition hover:border-primary/50 hover:bg-primary/[0.035] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:min-h-36"
            >
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><ImagePlus className="size-5" /></span>
              <span className="mt-3 text-sm font-bold">{preparingPhotos || 'Escolher da galeria'}</span>
              <span className="mt-1 text-xs text-muted-foreground">Qualidade otimizada para ampliar no computador</span>
            </button>
            <button type="button" className="min-h-11 rounded-xl text-sm font-semibold text-primary underline-offset-4 hover:underline sm:col-span-2" onClick={() => cameraInput.current?.click()} disabled={photos.length >= 8 || submitting || Boolean(preparingPhotos)}>
              Usar a câmera do aparelho em vez da câmera contínua
            </button>
            <input
              ref={cameraInput}
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => { void addPhotos(event.target.files); event.target.value = ''; }}
              aria-label="Tirar uma foto com a câmera traseira"
            />
            <input
              ref={galleryInput}
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => { void addPhotos(event.target.files); event.target.value = ''; }}
              aria-label="Escolher fotos da galeria"
            />
          </section>

          <section aria-labelledby="selected-photos-title">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="selected-photos-title" className="text-sm font-bold">Fotos adicionadas</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Toque em uma foto para conferir e ampliar.</p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold">{photos.length}/8</span>
            </div>

            {previews.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed bg-card/60 px-5 py-7 text-center">
                <Camera className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">Nenhuma foto adicionada</p>
                <p className="mt-1 text-xs text-muted-foreground">Uma foto ou um vídeo já é suficiente para abrir o protocolo.</p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {previews.map((preview, index) => (
                  <div key={`${preview.file.name}-${preview.file.lastModified}-${index}`} className="relative aspect-square overflow-hidden rounded-2xl border bg-muted shadow-sm">
                    <button
                      type="button"
                      className="h-full w-full outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                      onClick={() => { setViewerIndex(index); setViewerOpen(true); }}
                      aria-label={`Ampliar foto ${index + 1} de ${previews.length}`}
                    >
                      {/* Local blob previews cannot use the public image optimizer. */}
                      {/* eslint-disable-next-line next/no-img-element */}
                      <img src={preview.url} alt={preview.alt} className="h-full w-full object-cover" />
                    </button>
                    <span className="pointer-events-none absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-lg bg-black/60 text-[11px] font-bold text-white">{index + 1}</span>
                    <button
                      type="button"
                      className="absolute right-1 top-1 grid size-11 place-items-center rounded-xl bg-black/65 text-white shadow-md outline-none hover:bg-black/80 focus-visible:ring-3 focus-visible:ring-white/70"
                      onClick={() => removePhoto(index)}
                      aria-label={`Remover foto ${index + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5" aria-labelledby="video-title">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600"><Video className="size-5" /></span>
              <div className="min-w-0 flex-1"><h2 id="video-title" className="text-sm font-semibold">Vídeo curto <span className="font-normal text-muted-foreground">· opcional</span></h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Até 20 segundos e 40 MB. Use para mostrar defeitos, ruídos ou o estado completo do pacote.</p></div>
            </div>
            {video && videoPreviewUrl ? (
              <div className="mt-4 overflow-hidden rounded-2xl border bg-slate-950">
                {/* This local package preview has no authored dialogue or caption track. */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={videoPreviewUrl} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" aria-label="Prévia do vídeo selecionado" />
                <div className="flex flex-wrap items-center justify-between gap-3 bg-card px-3 py-3"><p className="text-xs font-medium">{formatVideoDuration(video.durationMs)} · {formatVideoSize(video.file.size)}</p><Button type="button" variant="ghost" size="sm" className="h-11 text-destructive" onClick={removeVideo}><Trash2 /> Remover vídeo</Button></div>
              </div>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" className="h-12 rounded-xl" disabled={submitting || preparingVideo} onClick={() => videoCameraInput.current?.click()}>{preparingVideo ? <Loader2 className="animate-spin" /> : <Video />} Gravar vídeo</Button>
                <Button type="button" variant="outline" className="h-12 rounded-xl" disabled={submitting || preparingVideo} onClick={() => videoGalleryInput.current?.click()}><Upload /> Escolher vídeo</Button>
              </div>
            )}
            <input ref={videoCameraInput} className="sr-only" type="file" accept="video/*" capture="environment" onChange={(event) => { void addVideo(event.target.files); event.target.value = ''; }} aria-label="Gravar vídeo com a câmera traseira" />
            <input ref={videoGalleryInput} className="sr-only" type="file" accept="video/mp4,video/quicktime,video/3gpp,.mp4,.m4v,.mov,.3gp,.3gpp" onChange={(event) => { void addVideo(event.target.files); event.target.value = ''; }} aria-label="Escolher vídeo da galeria" />
          </section>

          <details
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            className="group rounded-2xl border bg-card shadow-sm"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">Dados rápidos do recebimento</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">Selecione primeiro o local e a loja</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
            </summary>
            <div className="grid gap-4 border-t px-4 py-5 sm:grid-cols-2">
              <Field label="Data e hora recebida" htmlFor="receipt-date">
                <Input id="receipt-date" className="h-11" type="datetime-local" value={fields.receivedAt} onChange={(event) => updateField('receivedAt', event.target.value)} />
              </Field>
              <Field label="ID do pedido" htmlFor="receipt-order" hint="Opcional">
                <Input id="receipt-order" className="h-11" placeholder="Ex.: 200000123456" value={fields.orderId} onChange={(event) => updateField('orderId', event.target.value)} />
              </Field>
              <Field label="Código de rastreio" htmlFor="receipt-tracking" hint="Opcional">
                <Input id="receipt-tracking" className="h-11 uppercase" placeholder="Ex.: AB123456789BR" value={fields.trackingCode} onChange={(event) => updateField('trackingCode', event.target.value)} />
              </Field>
              <Field label="Produto" htmlFor="receipt-product" hint="Opcional">
                <TinyProductInput value={fields.product} onChange={(product) => updateField('product', product)} placeholder="Buscar no Tiny por nome ou SKU" />
              </Field>
              <Field label="Quantidade" htmlFor="receipt-quantity" hint="Opcional">
                <Input id="receipt-quantity" className="h-11" type="number" inputMode="numeric" min={1} value={fields.quantity} onChange={(event) => updateField('quantity', event.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Observação" htmlFor="receipt-notes" hint="Opcional">
                  <Textarea id="receipt-notes" rows={3} placeholder="Estado da embalagem ou alguma informação importante..." value={fields.notes} onChange={(event) => updateField('notes', event.target.value)} />
                </Field>
              </div>
            </div>
          </details>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertTitle>Não foi possível continuar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Fotos e vídeos ficam protegidos no sistema e só podem ser abertos por pessoas com acesso.
          </p>
        </div>

        <footer className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t bg-card/96 px-4 pt-3 shadow-[0_-12px_35px_rgb(28_39_36/8%)] backdrop-blur-xl sm:px-6">
          <div className="mx-auto max-w-3xl">
            <Button type="submit" className="h-13 w-full rounded-xl text-[15px] font-bold shadow-[0_10px_24px_rgb(13_96_83/20%)]" disabled={submitting || Boolean(preparingPhotos) || preparingVideo || mediaCount === 0}>
              {submitting ? <><Loader2 className="animate-spin" /> Enviando {mediaCount} {mediaCount === 1 ? 'arquivo' : 'arquivos'}...</> : preparingPhotos ? <><Loader2 className="animate-spin" /> {preparingPhotos}</> : preparingVideo ? <><Loader2 className="animate-spin" /> Preparando vídeo…</> : <><CheckCircle2 /> Registrar recebimento</>}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground" aria-live="polite">
              {submitting ? 'Não feche esta tela enquanto os arquivos são enviados.' : 'Pedido, rastreio e produto podem ser preenchidos depois.'}
            </p>
          </div>
        </footer>
      </form>

      <PhotoLightbox
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        photos={viewerPhotos}
        initialIndex={viewerIndex}
      />
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
