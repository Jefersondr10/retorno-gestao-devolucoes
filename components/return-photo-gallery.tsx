'use client';

import { useMemo, useState } from 'react';
import { Download, Expand, Images, Loader2, Trash2, Video } from 'lucide-react';

import { PhotoLightbox } from '@/components/photo-lightbox';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { formatVideoDuration, formatVideoSize } from '@/lib/client-video';
import type { ReturnDetail } from '@/lib/returns';
import { cn } from '@/lib/utils';

export function ReturnPhotoGallery({
  protocol,
  photos,
  videos = [],
  returnId,
  finalized = false,
  canDeleteVideos = false,
  onVideosDeleted,
}: {
  protocol: string;
  photos: ReturnDetail['photos'];
  videos?: ReturnDetail['videos'];
  returnId?: string;
  finalized?: boolean;
  canDeleteVideos?: boolean;
  onVideosDeleted?: (count: number, storagePending: boolean) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [deletingVideos, setDeletingVideos] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [playbackErrors, setPlaybackErrors] = useState<string[]>([]);
  const viewerPhotos = useMemo(
    () =>
      photos.map((photo, index) => ({
        src: `/api/photos/${photo.id}`,
        alt: `Foto ${index + 1} de ${photos.length} da devolução ${protocol}`,
        label: `${protocol} · Foto ${index + 1}`,
      })),
    [photos, protocol],
  );

  if (photos.length === 0 && videos.length === 0) return null;
  const safeSelected = photos.length ? Math.min(selected, photos.length - 1) : 0;
  const active = viewerPhotos[safeSelected];
  const activePhoto = photos[safeSelected];

  function downloadAll() {
    photos.forEach((photo, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a');
        link.href = `/api/photos/${photo.id}?download=1`;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 180);
    });
  }

  async function deleteOnlyVideos() {
    if (!returnId || videos.length === 0) return;
    const label = videos.length === 1 ? 'o vídeo' : `os ${videos.length} vídeos`;
    if (!window.confirm(`Excluir somente ${label} de ${protocol}? Esta exclusão é permanente. As fotos, os dados e a devolução finalizada serão mantidos.`)) return;
    setDeletingVideos(true);
    setVideoError('');
    try {
      const response = await apiFetch(`/api/returns/${returnId}/videos`, { method: 'DELETE' });
      const result = (await response.json()) as { deleted?: number; storagePending?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir os vídeos.');
      await onVideosDeleted?.(result.deleted || videos.length, Boolean(result.storagePending));
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : 'Não foi possível excluir os vídeos.');
    } finally {
      setDeletingVideos(false);
    }
  }

  return (
    <section className="bg-muted/25 px-5 py-5 sm:px-6" aria-labelledby="return-media-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="return-media-title" className="flex items-center gap-2 text-sm font-bold">
            <Images className="size-[18px] text-primary" /> Fotos e vídeos recebidos
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Visualize, amplie ou baixe os arquivos desta devolução.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {photos.length > 0 && <Badge variant="secondary">{photos.length} {photos.length === 1 ? 'foto' : 'fotos'}</Badge>}
          {videos.length > 0 && <Badge variant="secondary">{videos.length} {videos.length === 1 ? 'vídeo' : 'vídeos'}</Badge>}
        </div>
      </div>

      {photos.length > 0 && active && activePhoto && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Foto {safeSelected + 1} de {photos.length} · clique para ampliar</p>
          <button
            type="button"
            className="group relative flex h-[280px] w-full items-center justify-center overflow-hidden rounded-2xl border bg-slate-950 shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-[420px]"
            onClick={() => setViewerOpen(true)}
            aria-label={`Ampliar foto ${safeSelected + 1} de ${photos.length} da devolução ${protocol}`}
          >
            {/* Private photos are streamed by an authenticated application route. */}
            {/* eslint-disable-next-line next/no-img-element */}
            <img src={active.src} alt={active.alt} className="h-full w-full object-contain" />
            <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-xl bg-black/65 px-3 py-2 text-xs font-semibold text-white shadow-lg transition group-hover:bg-black/80">
              <Expand className="size-4" /> Ampliar e dar zoom
            </span>
          </button>

          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/photos/${activePhoto.id}?download=1`} download className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-10 rounded-xl')}>
              <Download /> Baixar foto {safeSelected + 1}
            </a>
            {photos.length > 1 && <ButtonDownloadAll onClick={downloadAll} count={photos.length} />}
          </div>

          {photos.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Miniaturas das fotos">
              {viewerPhotos.map((photo, index) => (
                <button
                  key={photos[index].id}
                  type="button"
                  className={`relative size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-20 ${index === safeSelected ? 'border-primary' : 'border-transparent opacity-75 hover:opacity-100'}`}
                  onClick={() => setSelected(index)}
                  aria-label={`Mostrar foto ${index + 1} de ${photos.length} da devolução ${protocol}`}
                  aria-current={index === safeSelected ? 'true' : undefined}
                >
                  {/* eslint-disable-next-line next/no-img-element */}
                  <img src={photo.src} alt="" className="h-full w-full object-cover" />
                  <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-md bg-black/65 text-[10px] font-bold text-white">{index + 1}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {videos.length > 0 && (
        <div className={cn('space-y-3', photos.length > 0 && 'mt-6 border-t pt-5')}>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold"><Video className="size-[18px] text-primary" /> {videos.length === 1 ? 'Vídeo recebido' : 'Vídeos recebidos'}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Use os controles para assistir em tela cheia ou avançar.</p>
          </div>

          {videos.map((video, index) => (
            <article key={video.id} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              {/* Package inspection videos do not contain authored dialogue or captions. */}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                controls
                playsInline
                preload="metadata"
                src={`/api/videos/${video.id}`}
                className="aspect-video max-h-[420px] w-full bg-slate-950 object-contain"
                aria-label={`Vídeo ${index + 1} de ${videos.length} da devolução ${protocol}`}
                onError={() => setPlaybackErrors((current) => current.includes(video.id) ? current : [...current, video.id])}
                onLoadedMetadata={() => setPlaybackErrors((current) => current.filter((id) => id !== video.id))}
              />
              {playbackErrors.includes(video.id) && <p role="alert" className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Não foi possível reproduzir este formato neste aparelho. Baixe o vídeo para abrir no programa de sua preferência.</p>}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{videos.length === 1 ? 'Vídeo da devolução' : `Vídeo ${index + 1}`}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{video.duration_ms ? formatVideoDuration(video.duration_ms) : 'Duração não informada'} · {formatVideoSize(video.size)}</p>
                </div>
                <a href={`/api/videos/${video.id}?download=1`} download className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-11 rounded-xl')}>
                  <Download /> Baixar vídeo
                </a>
              </div>
            </article>
          ))}

          {finalized && returnId && canDeleteVideos && (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-xs leading-5 text-muted-foreground">Para liberar espaço, você pode apagar somente {videos.length === 1 ? 'o vídeo' : 'os vídeos'}. As fotos e todo o histórico continuarão guardados.</p>
              <Button type="button" variant="ghost" size="sm" className="mt-2 h-11 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deletingVideos} onClick={() => void deleteOnlyVideos()}>
                {deletingVideos ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir somente {videos.length === 1 ? 'o vídeo' : 'os vídeos'}
              </Button>
            </div>
          )}
          {videoError && <p role="alert" className="text-xs font-medium text-destructive">{videoError}</p>}
        </div>
      )}

      {photos.length > 0 && (
        <PhotoLightbox
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          photos={viewerPhotos}
          initialIndex={safeSelected}
        />
      )}
    </section>
  );
}

function ButtonDownloadAll({ onClick, count }: { onClick: () => void; count: number }) {
  return <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={onClick}><Download /> Baixar todas ({count})</Button>;
}
