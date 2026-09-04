'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Video, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const MAX_DURATION_SECONDS = 20;

export function ContinuousVideoRecorder({ disabled, onCapture, onNativeFallback }: {
  disabled: boolean;
  onCapture: (file: File) => void;
  onNativeFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    void videoRef.current.play().catch(() => setError('A imagem da câmera não pôde ser iniciada.'));
  }, [open, stream]);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);

  async function startCamera() {
    if (disabled) return;
    setOpen(true);
    setStarting(true);
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/mp4')) throw new Error('unsupported');
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      });
      const track = nextStream.getVideoTracks()[0];
      if (track) {
        track.contentHint = 'detail';
        const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { focusMode?: string[] };
        if (capabilities?.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
      }
      setStream(nextStream);
    } catch (cameraError) {
      setError(cameraError instanceof DOMException && cameraError.name === 'NotAllowedError'
        ? 'Autorize o acesso à câmera e ao microfone nas configurações do navegador.'
        : 'Este aparelho não oferece gravação otimizada no navegador. Use a câmera do aparelho.');
    } finally {
      setStarting(false);
    }
  }

  function closeCamera() {
    if (recording && recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
    if (timerRef.current) window.clearInterval(timerRef.current);
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setRecording(false);
    setSeconds(0);
    setOpen(false);
  }

  function startRecording() {
    if (!stream) return;
    chunksRef.current = [];
    const preferredTypes = ['video/mp4;codecs=h264,aac', 'video/mp4'];
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || 'video/mp4';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : { videoBitsPerSecond: 4_000_000 });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const file = new File(chunksRef.current, `devolucao-${Date.now()}.mp4`, { type, lastModified: Date.now() });
      if (file.size) onCapture(file);
      closeCamera();
    };
    recorder.start(500);
    setRecording(true);
    setSeconds(0);
    timerRef.current = window.setInterval(() => setSeconds((current) => {
      const next = current + 1;
      if (next >= MAX_DURATION_SECONDS) recorderRef.current?.stop();
      return next;
    }), 1000);
  }

  function finishRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    recorderRef.current?.stop();
  }

  return <>
    <Button type="button" variant="outline" className="h-12 rounded-xl" disabled={disabled} onClick={() => void startCamera()}><Video /> Gravar vídeo</Button>
    {open && <dialog open className="fixed inset-0 z-[80] m-0 grid h-[100dvh] max-h-none w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] bg-black p-0 text-white" aria-label="Gravar vídeo da devolução">
      <header className="flex min-h-16 items-center gap-3 border-b border-white/10 bg-black/90 px-4 safe-top"><div className="min-w-0 flex-1"><p className="font-bold">Gravar vídeo</p><p className="text-xs text-white/65">Foco contínuo · máximo de 20 segundos</p></div><Button type="button" variant="ghost" className="h-11 text-white hover:bg-white/10 hover:text-white" onClick={closeCamera}><X /> Fechar</Button></header>
      <div className="relative min-h-0 overflow-hidden bg-black"><video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" aria-label="Imagem ao vivo para gravação" />
        {starting && <div className="absolute inset-0 grid place-items-center bg-black/75"><Loader2 className="size-8 animate-spin" /></div>}
        {recording && <div className="absolute left-4 top-4 rounded-full bg-red-600 px-3 py-1.5 text-sm font-bold shadow-lg">● REC {seconds}s</div>}
        {error && <div className="absolute inset-x-4 top-4 mx-auto max-w-lg"><Alert variant="destructive" className="border-red-300 bg-red-50 text-red-900"><AlertTitle>Não foi possível abrir a câmera</AlertTitle><AlertDescription>{error}</AlertDescription></Alert><Button type="button" variant="secondary" className="mt-3 h-11 w-full" onClick={() => { closeCamera(); onNativeFallback(); }}><Video /> Usar câmera do aparelho</Button></div>}
      </div>
      <footer className="safe-bottom border-t border-white/10 bg-black/95 px-4 py-4"><div className="mx-auto flex max-w-lg justify-center">{recording ? <Button type="button" variant="secondary" className="h-14 rounded-2xl px-6" onClick={finishRecording}><Check /> Finalizar vídeo ({seconds}s)</Button> : <button type="button" onClick={startRecording} disabled={!stream || starting || Boolean(error)} className="grid size-16 place-items-center rounded-full border-4 border-white bg-red-600 outline-none transition active:scale-95 disabled:opacity-40" aria-label="Iniciar gravação"><span className="size-8 rounded-full bg-red-500" /></button>}</div><p className="mt-2 text-center text-xs text-white/60">Mantenha o produto no centro e aguarde o foco ajustar antes de iniciar.</p></footer>
    </dialog>}
  </>;
}
