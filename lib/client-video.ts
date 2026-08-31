export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 20;

export type PreparedVideo = {
  file: File;
  durationMs: number;
};

function inferredVideoType(file: File) {
  if (['video/mp4', 'video/quicktime', 'video/3gpp'].includes(file.type)) return file.type;
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (extension === 'mov') return 'video/quicktime';
  if (extension === '3gp' || extension === '3gpp') return 'video/3gpp';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  return '';
}

function readDurationMs(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error('Não foi possível ler a duração do vídeo. Tente gravar novamente.')), 10_000);

    function cleanup() {
      window.clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }

    function finish(error?: Error, durationMs?: number) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(durationMs || 0);
    }

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const durationMs = video.duration * 1000;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        finish(new Error('Não foi possível confirmar a duração do vídeo. Tente gravar novamente.'));
        return;
      }
      finish(undefined, durationMs);
    };
    video.onerror = () => finish(new Error('Formato de vídeo não reconhecido. Use MP4, MOV ou 3GP.'));
    video.src = url;
  });
}

export async function prepareVideoFile(input: File): Promise<PreparedVideo> {
  const contentType = inferredVideoType(input);
  if (!contentType) throw new Error('Use um vídeo MP4, MOV ou 3GP.');
  if (input.size > MAX_VIDEO_BYTES) throw new Error('O vídeo deve ter no máximo 40 MB. Grave um trecho mais curto.');
  const file = input.type === contentType ? input : new File([input], input.name, { type: contentType, lastModified: input.lastModified });
  const durationMs = await readDurationMs(file);
  if (durationMs > MAX_VIDEO_DURATION_SECONDS * 1000 + 250) throw new Error('O vídeo deve ter no máximo 20 segundos.');
  return { file, durationMs: Math.round(durationMs) };
}

export function formatVideoDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `00:${String(seconds).padStart(2, '0')}`;
}

export function formatVideoSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
