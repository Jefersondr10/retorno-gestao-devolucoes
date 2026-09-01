import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const { db, files } = getBindings();
    const current = await db.prepare('SELECT protocol, status FROM returns WHERE id = ?').bind(id).first<{ protocol: string; status: string }>();
    if (!current) return apiError('Devolução não encontrada.', 404);
    if (current.status !== 'FINALIZED') return apiError('Os vídeos só podem ser excluídos depois que a devolução for finalizada.', 409);

    const videos = await db
      .prepare('SELECT id, object_key, file_name, size FROM return_videos WHERE return_id = ?')
      .bind(id)
      .all<{ id: string; object_key: string; file_name: string; size: number }>();
    if (!videos.results.length) return Response.json({ deleted: 0 });

    const now = new Date().toISOString();
    const actor = actorLabel(auth.user);
    const auditId = crypto.randomUUID();
    const details = {
      count: videos.results.length,
      bytes: videos.results.reduce((total, video) => total + video.size, 0),
      files: videos.results.map((video) => video.file_name),
      objectKeys: videos.results.map((video) => video.object_key),
    };
    await db.batch([
      db.prepare('DELETE FROM return_videos WHERE return_id = ?').bind(id),
      db.prepare('UPDATE returns SET updated_by = ?, updated_at = ? WHERE id = ?').bind(actor, now, id),
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, ?, ?, 'VIDEOS_DELETION_PENDING', ?, ?)")
        .bind(
          auditId,
          id,
          actor,
          JSON.stringify(details),
          now,
        ),
    ]);

    let storagePending = false;
    try {
      await files.delete(details.objectKeys);
      await db
        .prepare("UPDATE audit_events SET action = 'VIDEOS_DELETED', details = ? WHERE id = ?")
        .bind(JSON.stringify({ ...details, storageDeletedAt: new Date().toISOString() }), auditId)
        .run();
    } catch (storageError) {
      storagePending = true;
      console.error('Video storage deletion queued for retry', storageError);
    }
    return Response.json({ deleted: videos.results.length, storagePending }, { status: storagePending ? 202 : 200 });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível excluir os vídeos.', 500);
  }
}
