'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { canvasToOptimizedPhoto, PHOTO_LONG_EDGE } from '@/lib/client-images';

export function ContinuousCamera({
  disabled,
  photoCount,
  previews,
  onCapture,
  onNativeFallback,
}: {
  disabled: boolean;
  photoCount: number;
  previews: Array<{ url: string; alt: string }>;
  onCapture: (file: File) => void;
  onNativeFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestIdRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!open || !stream || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = stream;
    void video.play().catch(() => setError('A câmera abriu, mas a imagem não pôde ser iniciada. Use a câmera do aparelho.'));
    const track = stream.getVideoTracks()[0];
    function ended() {
      setReady(false);
      setError('A câmera foi interrompida pelo aparelho. Você pode tentar novamente ou usar a câmera do sistema.');
    }
    track?.addEventListener('ended', ended);
    return () => track?.removeEventListener('ended', ended);
  }, [open, stream]);

  useEffect(() => {
    if (!stream) return;
    const activeStream = stream;
    function stopOnPageHide() {
      activeStream.getTracks().forEach((track) => track.stop());
    }
    window.addEventListener('pagehide', stopOnPageHide);
    return () => {
      window.removeEventListener('pagehide', stopOnPageHide);
      activeStream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  function humanCameraError(cameraError: unknown) {
    if (!(cameraError instanceof DOMException)) return 'Não foi possível abrir a câmera. Use a câmera do aparelho como alternativa.';
    if (cameraError.name === 'NotAllowedError') return 'O acesso à câmera não foi permitido. Autorize nas configurações do navegador ou use a câmera do aparelho.';
    if (cameraError.name === 'NotFoundError') return 'Nenhuma câmera foi encontrada neste aparelho.';
    if (cameraError.name === 'NotReadableError') return 'A câmera está sendo usada por outro aplicativo ou outra aba.';
    return 'A câmera não pôde ser iniciada neste aparelho. Use a câmera do sistema como alternativa.';
  }

  async function startCamera() {
    if (disabled) return;
    const requestId = ++requestIdRef.current;
    setOpen(true);
    setStarting(true);
    setError('');
    setReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      let nextStream: MediaStream;
      try {
        nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
        });
      } catch (cameraError) {
        if (cameraError instanceof DOMException && cameraError.name === 'OverconstrainedError') {
          nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } else {
          throw cameraError;
        }
      }
      if (requestId !== requestIdRef.current) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      setStream(nextStream);
    } catch (cameraError) {
      setError(humanCameraError(cameraError));
    } finally {
      setStarting(false);
    }
  }

  function stopCamera() {
    requestIdRef.current += 1;
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setReady(false);
    setOpen(false);
    setError('');
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || !ready || video.videoWidth === 0 || photoCount >= 8) return;
    setCapturing(true);
    const ratio = Math.min(1, PHOTO_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
    canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) {
      setCapturing(false);
      setError('Não foi possível registrar esta foto. Tente novamente.');
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const file = await canvasToOptimizedPhoto(canvas);
      const nextNumber = photoCount + 1;
      onCapture(file);
      setAnnouncement(`Foto ${nextNumber} adicionada.`);
      if ('vibrate' in navigator) navigator.vibrate?.(40);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Não foi possível registrar esta foto. Tente novamente.');
    } finally {
      setCapturing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={startCamera}
        disabled={disabled}
        className="flex min-h-40 flex-col items-center justify-center rounded-3xl bg-primary px-5 py-6 text-center text-primary-foreground shadow-[0_14px_32px_rgb(13_96_83/22%)] outline-none transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-white/15"><Camera className="size-6" /></span>
        <span className="mt-3 text-base font-bold">Abrir câmera</span>
        <span className="mt-1 text-xs text-primary-foreground/80">Tire várias fotos e finalize depois</span>
      </button>

      {open && (
        <dialog open className="fixed inset-0 z-[80] m-0 grid h-[100dvh] max-h-none w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] bg-black p-0 text-white" aria-label="Câmera para várias fotos">
          <header className="flex min-h-16 items-center gap-3 border-b border-white/10 bg-black/90 px-4 safe-top">
            <div className="min-w-0 flex-1"><p className="font-bold">Fotografar devolução</p><p className="text-xs text-white/65">Câmera ativa · {photoCount}/8 fotos</p></div>
            <Button type="button" variant="ghost" className="h-11 text-white hover:bg-white/10 hover:text-white" onClick={stopCamera}><X /> Fechar</Button>
          </header>

          <div className="relative min-h-0 overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onCanPlay={() => setReady(true)}
              className="h-full w-full object-contain"
              aria-label="Imagem ao vivo da câmera"
            />
            {starting && <div className="absolute inset-0 grid place-items-center bg-black/75"><div className="text-center"><Loader2 className="mx-auto size-7 animate-spin" /><p className="mt-3 text-sm font-semibold">Abrindo a câmera...</p></div></div>}
            {error && (
              <div className="absolute inset-x-4 top-4 z-10 mx-auto max-w-lg">
                <Alert variant="destructive" className="border-red-300 bg-red-50 text-red-900"><AlertTitle>Não foi possível usar a câmera contínua</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
                <Button type="button" variant="secondary" className="mt-3 h-11 w-full" onClick={() => { stopCamera(); onNativeFallback(); }}><Camera /> Usar câmera do aparelho</Button>
              </div>
            )}
            {previews.length > 0 && (
              <div className="absolute inset-x-3 bottom-3 flex gap-2 overflow-x-auto rounded-2xl bg-black/55 p-2 backdrop-blur">
                {previews.slice(-5).map((preview, index) => (
                  <div key={preview.url} className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-white/30">
                    {/* Local blob previews cannot use the public image optimizer. */}
                    {/* eslint-disable-next-line next/no-img-element */}
                    <img src={preview.url} alt={preview.alt} className="h-full w-full object-cover" />
                    <span className="absolute bottom-0 right-0 bg-black/70 px-1 text-[9px] font-bold">{Math.max(1, photoCount - previews.slice(-5).length + index + 1)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="safe-bottom border-t border-white/10 bg-black/95 px-4 pt-3">
            <div className="mx-auto grid max-w-lg grid-cols-[1fr_auto] items-center gap-4">
              <Button type="button" variant="secondary" className="h-12 rounded-xl" onClick={stopCamera} disabled={photoCount === 0}><Check /> Finalizar fotos ({photoCount})</Button>
              <button type="button" onClick={capturePhoto} disabled={!ready || capturing || photoCount >= 8} className="grid size-16 place-items-center rounded-full border-4 border-white bg-white/20 outline-none transition active:scale-95 disabled:opacity-40" aria-label="Tirar foto">
                {capturing ? <Loader2 className="size-6 animate-spin" /> : <span className="size-11 rounded-full bg-white" />}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-white/60">Toque no botão redondo para tirar outra foto sem fechar a câmera.</p>
          </footer>
          <output className="sr-only" aria-live="polite">{announcement}</output>
        </dialog>
      )}
    </>
  );
}
