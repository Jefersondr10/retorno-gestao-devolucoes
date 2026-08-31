import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureSchema();
    const { id } = await context.params;
    const { db, files } = getBindings();
    const photo = await db
      .prepare('SELECT object_key, content_type, file_name FROM return_photos WHERE id = ?')
      .bind(id)
      .first<{ object_key: string; content_type: string; file_name: string }>();
    if (!photo) return apiError('Foto não encontrada.', 404);
    const object = await files.get(photo.object_key);
    if (!object) return apiError('Arquivo da foto não encontrado.', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', photo.content_type);
    headers.set('Content-Disposition', `inline; filename="${photo.file_name.replace(/["\r\n]/g, '')}"`);
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(object.body, { headers });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível abrir a foto.', 500);
  }
}
