'use client';

import { useMemo, useState } from 'react';
import { Expand, Images } from 'lucide-react';

import { PhotoLightbox } from '@/components/photo-lightbox';
import { Badge } from '@/components/ui/badge';
import type { ReturnDetail } from '@/lib/returns';

export function ReturnPhotoGallery({
  protocol,
  photos,
}: {
  protocol: string;
  photos: ReturnDetail['photos'];
}) {
  const [selected, setSelected] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const viewerPhotos = useMemo(
    () =>
      photos.map((photo, index) => ({
        src: `/api/photos/${photo.id}`,
        alt: `Foto ${index + 1} de ${photos.length} da devolução ${protocol}`,
        label: `${protocol} · Foto ${index + 1}`,
      })),
    [photos, protocol],
  );

  if (photos.length === 0) return null;
  const safeSelected = Math.min(selected, photos.length - 1);
  const active = viewerPhotos[safeSelected];

  return (
    <section className="border-b bg-muted/25 px-5 py-5 sm:px-6" aria-labelledby="return-photos-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="return-photos-title" className="flex items-center gap-2 text-sm font-bold">
            <Images className="size-[18px] text-primary" /> Fotos recebidas
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Foto {safeSelected + 1} de {photos.length} · clique para ampliar</p>
        </div>
        <Badge variant="secondary">{photos.length} {photos.length === 1 ? 'foto' : 'fotos'}</Badge>
      </div>

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

      <PhotoLightbox
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        photos={viewerPhotos}
        initialIndex={safeSelected}
      />
    </section>
  );
}
