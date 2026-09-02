import { authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type PhotoRecord = {
  object_key: string;
  content_type: string;
  file_name: string;
  store: string | null;
  tracking_code: string | null;
  order_id: string | null;
  protocol: string;
  photo_number: number;
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

function photoExtension(photo: PhotoRecord) {
  const originalExtension = photo.file_name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
  if (originalExtension) return originalExtension.toLowerCase();
  if (photo.content_type === 'image/png') return '.png';
  if (photo.content_type === 'image/webp') return '.webp';
  if (photo.content_type === 'image/heic') return '.heic';
  return '.jpg';
}

function photoDownloadName(photo: PhotoRecord) {
  const store = safeFilePart(photo.store, 'Loja-nao-informada');
  const identifier = safeFilePart(photo.tracking_code || photo.order_id || photo.protocol, 'Devolucao');
  return `${store}-${identifier}-foto-${photo.photo_number || 1}${photoExtension(photo)}`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { csrf: false });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const { db, files } = getBindings();
    const photo = await db
      .prepare(`SELECT
          p.object_key,
          p.content_type,
          p.file_name,
          r.store,
          r.tracking_code,
          r.order_id,
          r.protocol,
          (SELECT COUNT(*)
             FROM return_photos earlier
            WHERE earlier.return_id = p.return_id
              AND (earlier.created_at < p.created_at OR (earlier.created_at = p.created_at AND earlier.id <= p.id))) AS photo_number
        FROM return_photos p
        INNER JOIN returns r ON r.id = p.return_id
        WHERE p.id = ? AND r.organization_id = ?`)
      .bind(id, auth.user.organizationId)
      .first<PhotoRecord>();
    if (!photo) return apiError('Foto não encontrada.', 404);
    const object = await files.get(photo.object_key);
    if (!object) return apiError('Arquivo da foto não encontrado.', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', photo.content_type);
    const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const fileName = disposition === 'attachment' ? photoDownloadName(photo) : photo.file_name.replace(/["\r\n]/g, '');
    headers.set('Content-Disposition', `${disposition}; filename="${fileName}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Vary', 'Cookie');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível abrir a foto.', 500);
  }
}
