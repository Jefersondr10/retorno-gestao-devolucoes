'use client';

import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCw,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export type ViewerPhoto = {
  src: string;
  alt: string;
  label?: string;
};

export function PhotoLightbox({
  open,
  onOpenChange,
  photos,
  initialIndex = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: ViewerPhoto[];
  initialIndex?: number;
}) {
  if (!open || photos.length === 0) return null;

  return (
    <OpenPhotoLightbox
      key={`${initialIndex}-${photos.length}`}
      onOpenChange={onOpenChange}
      photos={photos}
      initialIndex={initialIndex}
    />
  );
}

function OpenPhotoLightbox({
  onOpenChange,
  photos,
  initialIndex,
}: {
  onOpenChange: (open: boolean) => void;
  photos: ViewerPhoto[];
  initialIndex: number;
}) {
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(photos.length - 1, 0)));
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft' && photos.length > 1) {
        setIndex((current) => (current - 1 + photos.length) % photos.length);
        setZoom(1);
        setRotation(0);
      }
      if (event.key === 'ArrowRight' && photos.length > 1) {
        setIndex((current) => (current + 1) % photos.length);
        setZoom(1);
        setRotation(0);
      }
      if (event.key === '+' || event.key === '=') setZoom((current) => Math.min(4, current + 0.5));
      if (event.key === '-') setZoom((current) => Math.max(1, current - 0.5));
      if (event.key === '0') {
        setZoom(1);
        setRotation(0);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [photos.length]);

  const photo = photos[index];

  function move(direction: -1 | 1) {
    setIndex((current) => (current + direction + photos.length) % photos.length);
    setZoom(1);
    setRotation(0);
  }

  if (!photo) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 rounded-none bg-slate-950 p-0 text-white ring-0 sm:max-w-none"
      >
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold text-white">
              {photo.label || `Foto ${index + 1} de ${photos.length}`}
            </DialogTitle>
            <p className="mt-0.5 text-xs text-white/60">Foto {index + 1} de {photos.length}</p>
          </div>

          <div className="flex items-center gap-1" aria-label="Controles da imagem">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setZoom((current) => Math.max(1, current - 0.5))}
              disabled={zoom <= 1}
              aria-label="Reduzir zoom"
            >
              <Minus />
            </Button>
            <output className="min-w-12 text-center text-xs font-semibold text-white/80" aria-live="polite">
              {Math.round(zoom * 100)}%
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setZoom((current) => Math.min(4, current + 0.5))}
              disabled={zoom >= 4}
              aria-label="Ampliar zoom"
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setRotation((current) => current + 90)}
              aria-label="Girar foto"
            >
              <RotateCw />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="ml-1 text-white hover:bg-white/10 hover:text-white"
              onClick={() => onOpenChange(false)}
              aria-label="Fechar visualização"
            >
              <X />
            </Button>
          </div>
        </header>

        <div className="relative min-h-0 overflow-hidden bg-black">
          <div className="h-full w-full overflow-auto">
            <div
              className="flex items-center justify-center transition-[width,height] duration-150"
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            >
              {/* Private and local preview images cannot use the public image optimizer. */}
              {/* eslint-disable-next-line next/no-img-element */}
              <img
                src={photo.src}
                alt={photo.alt}
                className="h-full w-full select-none object-contain transition-transform duration-150"
                style={{ transform: `rotate(${rotation}deg)` }}
                draggable={false}
              />
            </div>
          </div>

          {photos.length > 1 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="absolute left-2 top-1/2 size-11 -translate-y-1/2 bg-black/45 text-white hover:bg-black/70 hover:text-white sm:left-5"
                onClick={() => move(-1)}
                aria-label="Foto anterior"
              >
                <ChevronLeft className="size-6" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="absolute right-2 top-1/2 size-11 -translate-y-1/2 bg-black/45 text-white hover:bg-black/70 hover:text-white sm:right-5"
                onClick={() => move(1)}
                aria-label="Próxima foto"
              >
                <ChevronRight className="size-6" />
              </Button>
            </>
          )}
        </div>

        <footer className="flex min-h-12 items-center justify-center border-t border-white/10 px-4 text-center text-xs text-white/60">
          Use os botões, as teclas + e − ou as setas do teclado. Pressione 0 para restaurar.
        </footer>
      </DialogContent>
    </Dialog>
  );
}
