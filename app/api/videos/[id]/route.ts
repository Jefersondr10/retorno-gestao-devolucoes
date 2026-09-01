import { authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type VideoRecord = {
  object_key: string;
  content_type: string;
  file_name: string;
  store: string | null;
  tracking_code: string | null;
  order_id: string | null;
  protocol: string;
  video_number: number;
};

function safeFilePart(value: string | null | undefined, fallback: string) {
  const cleaned = (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

function videoExtension(video: VideoRecord) {
  const originalExtension = video.file_name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
  if (originalExtension) return originalExtension.toLowerCase();
  if (video.content_type === 'video/quicktime') return '.mov';
  if (video.content_type === 'video/webm') return '.webm';
  return '.mp4';
}

function videoDownloadName(video: VideoRecord) {
  const store = safeFilePart(video.store, 'Loja-nao-informada');
  const identifier = safeFilePart(video.tracking_code || video.order_id || video.protocol, 'Devolucao');
  return `${store}-${identifier}-video-${video.video_number || 1}${videoExtension(video)}`;
}

function parseRange(value: string | null, size: number) {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (requestedStart === null && requestedEnd === null) return null;
  const start = requestedStart === null ? Math.max(0, size - requestedEnd!) : requestedStart;
  const end = requestedStart === null ? size - 1 : Math.min(requestedEnd ?? size - 1, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return null;
  return { offset: start, length: end - start + 1, end };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { csrf: false });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const { db, files } = getBindings();
    const video = await db
      .prepare(`SELECT
          v.object_key,
          v.content_type,
          v.file_name,
          r.store,
          r.tracking_code,
          r.order_id,
          r.protocol,
          (SELECT COUNT(*) FROM return_videos earlier
            WHERE earlier.return_id = v.return_id
              AND (earlier.created_at < v.created_at OR (earlier.created_at = v.created_at AND earlier.id <= v.id))) AS video_number
        FROM return_videos v
        INNER JOIN returns r ON r.id = v.return_id
        WHERE v.id = ?`)
      .bind(id)
      .first<VideoRecord>();
    if (!video) return apiError('Vídeo não encontrado.', 404);

    const metadata = await files.head(video.object_key);
    if (!metadata) return apiError('Arquivo do vídeo não encontrado.', 404);
    const rangeHeader = request.headers.get('range');
    const range = rangeHeader ? parseRange(rangeHeader, metadata.size) : null;
    if (rangeHeader && !range) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}`, 'Accept-Ranges': 'bytes' } });
    }

    const object = await files.get(video.object_key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
    if (!object) return apiError('Arquivo do vídeo não encontrado.', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', video.content_type);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(range?.length ?? metadata.size));
    if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.end}/${metadata.size}`);
    const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const fileName = disposition === 'attachment' ? videoDownloadName(video) : video.file_name.replace(/["\r\n]/g, '');
    headers.set('Content-Disposition', `${disposition}; filename="${fileName}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Vary', 'Cookie');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível abrir o vídeo.', 500);
  }
}
