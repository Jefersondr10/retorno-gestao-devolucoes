export const MAX_PHOTO_BYTES = Math.floor(2.5 * 1024 * 1024);
export const PHOTO_LONG_EDGE = 2048;

const TARGET_PHOTO_BYTES = Math.floor(1.5 * 1024 * 1024);
const qualitySteps = [0.9, 0.84, 0.78, 0.72];

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a foto.')), 'image/jpeg', quality);
  });
}

function resizedCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, maxLongEdge: number) {
  const ratio = Math.min(1, maxLongEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
  canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Não foi possível preparar a foto neste aparelho.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function optimizedFile(source: CanvasImageSource, width: number, height: number, baseName: string) {
  let smallestBlob: Blob | null = null;
  for (const maxLongEdge of [PHOTO_LONG_EDGE, 1800, 1600]) {
    const canvas = resizedCanvas(source, width, height, maxLongEdge);
    for (const quality of qualitySteps) {
      const blob = await canvasBlob(canvas, quality);
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;
      if (blob.size <= TARGET_PHOTO_BYTES || (quality === qualitySteps.at(-1) && blob.size <= MAX_PHOTO_BYTES)) {
        return new File([blob], `${baseName.replace(/\.[^.]+$/, '') || 'foto'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      }
    }
  }
  if (!smallestBlob || smallestBlob.size > MAX_PHOTO_BYTES) throw new Error('A foto ficou grande demais mesmo após a otimização. Tente fotografar novamente.');
  return new File([smallestBlob], `${baseName.replace(/\.[^.]+$/, '') || 'foto'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function normalizeImageFile(file: File) {
  const looksLikeImage = file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
  if (!looksLikeImage) throw new Error(`${file.name}: escolha somente arquivos de imagem.`);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Imagem sem dimensões válidas.');
    return await optimizedFile(image, image.naturalWidth, image.naturalHeight, file.name || `foto-${Date.now()}.jpg`);
  } catch {
    const isHeic = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
    throw new Error(isHeic
      ? `${file.name}: este aparelho não conseguiu converter a foto do iPhone. Use “Abrir câmera” para fotografar em formato compatível.`
      : `${file.name}: não foi possível ler esta imagem.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function canvasToOptimizedPhoto(canvas: HTMLCanvasElement, baseName = `foto-${Date.now()}.jpg`) {
  return optimizedFile(canvas, canvas.width, canvas.height, baseName);
}
