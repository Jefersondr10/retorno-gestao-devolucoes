import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ code: string }> };
const essentialStatuses = new Set(['PENDING_INFO', 'WAITING_TEST', 'WAITING_ENTRY', 'READY', 'FINALIZED']);

function validColor(value: string | undefined) {
  const requested = value?.trim() || '';
  const named = ['slate', 'amber', 'blue', 'sky', 'orange', 'violet', 'emerald', 'rose'];
  if (/^#[0-9a-f]{6}$/i.test(requested)) return requested.toLowerCase();
  return named.includes(requested) ? requested : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { code } = await context.params;
    const { db } = getBindings();
    const current = await db
      .prepare('SELECT code, label, color, is_system, sort_order, active FROM status_definitions WHERE code = ?')
      .bind(code)
      .first<{ code: string; label: string; color: string; is_system: number; sort_order: number; active: number }>();
    if (!current) return apiError('Status não encontrado.', 404);
    const body = (await request.json()) as { label?: string; color?: string; active?: boolean };
    const label = body.label?.trim() || current.label;
    const color = body.color === undefined ? current.color : validColor(body.color);
    const active = body.active === undefined ? current.active : body.active ? 1 : 0;
    if (!label || label.length > 60) return apiError('Informe um nome com até 60 caracteres.', 422);
    if (!color) return apiError('Selecione uma cor válida.', 422);
    if (!active && essentialStatuses.has(code)) return apiError('Este status é essencial para o funcionamento do sistema e não pode ser inativado.', 409);

    const now = new Date().toISOString();
    await db.batch([
      db.prepare('UPDATE status_definitions SET label = ?, color = ?, active = ? WHERE code = ?').bind(label, color, active, code),
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'STATUS_UPDATED', ?, ?)")
        .bind(crypto.randomUUID(), actorLabel(auth.user), JSON.stringify({ code, previous: current, next: { label, color, active } }), now),
    ]);
    return Response.json({ item: { ...current, label, color, active } });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível atualizar o status.', 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { code } = await context.params;
    const { db } = getBindings();
    const current = await db
      .prepare('SELECT code, label, is_system FROM status_definitions WHERE code = ?')
      .bind(code)
      .first<{ code: string; label: string; is_system: number }>();
    if (!current) return apiError('Status não encontrado.', 404);
    if (current.is_system) return apiError('Status do sistema não pode ser excluído.', 409);
    const usage = await db.prepare('SELECT COUNT(*) AS count FROM returns WHERE status = ?').bind(code).first<{ count: number }>();
    if (Number(usage?.count || 0) > 0) return apiError(`Este status está em uso em ${usage?.count} devolução(ões). Inative-o em vez de excluir.`, 409);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('DELETE FROM status_definitions WHERE code = ?').bind(code),
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'STATUS_DELETED', ?, ?)")
        .bind(crypto.randomUUID(), actorLabel(auth.user), JSON.stringify(current), now),
    ]);
    return Response.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível excluir o status.', 500);
  }
}
