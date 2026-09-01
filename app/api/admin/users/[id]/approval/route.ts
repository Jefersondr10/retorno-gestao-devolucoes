import { actorLabel, authenticateApi, type UserRole } from '@/lib/auth';
import { ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authenticateApi(request, { roles: ['ADMIN'] });
  if ('response' in auth) return auth.response;

  const parsed = await request.json().catch(() => null) as unknown;
  const decision = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { decision?: unknown }).decision
    : undefined;
  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return Response.json({ error: 'Escolha aprovar ou recusar a solicitação.' }, { status: 422 });
  }

  await ensureSchema();
  const { db } = getBindings();
  const { id } = await context.params;
  const current = await db
    .prepare(`SELECT id, username, display_name, role, active, approval_status, google_email,
      password_login_enabled, updated_at,
      CASE WHEN google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider
      FROM users WHERE id = ?`)
    .bind(id)
    .first<{
      id: string;
      username: string;
      display_name: string;
      role: UserRole;
      active: number;
      approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
      google_email: string | null;
      password_login_enabled: number;
      updated_at: string;
      provider: 'PASSWORD' | 'GOOGLE';
    }>();

  if (!current) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  const canDecide = current.provider === 'GOOGLE'
    && (current.approval_status === 'PENDING' || (decision === 'APPROVE' && current.approval_status === 'REJECTED'));
  if (!canDecide) {
    return Response.json({ error: 'Esta solicitação já foi analisada.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const approved = decision === 'APPROVE';
  const nextStatus = approved ? 'APPROVED' : 'REJECTED';
  const nextActive = approved ? 1 : 0;
  const action = approved
    ? current.approval_status === 'REJECTED' ? 'GOOGLE_USER_REAPPROVED' : 'GOOGLE_USER_APPROVED'
    : 'GOOGLE_USER_REJECTED';
  const update = db
    .prepare(`UPDATE users
      SET approval_status = ?, active = ?, role = 'OPERATOR', updated_at = ?
      WHERE id = ? AND approval_status = ? AND google_sub IS NOT NULL AND updated_at = ?`)
    .bind(nextStatus, nextActive, now, id, current.approval_status, current.updated_at);
  const guard = `EXISTS (
    SELECT 1 FROM users WHERE id = ? AND approval_status = ? AND active = ? AND updated_at = ?
  )`;
  const [result] = await db.batch([
    update,
    db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND ${guard}`)
      .bind(id, id, nextStatus, nextActive, now),
    db.prepare(`INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
      SELECT ?, NULL, ?, ?, ?, ? WHERE ${guard}`)
      .bind(
        crypto.randomUUID(),
        actorLabel(auth.user),
        action,
        JSON.stringify({ userId: id, username: current.username, email: current.google_email }),
        now,
        id,
        nextStatus,
        nextActive,
        now,
      ),
  ]);

  if (!Number(result.meta.changes || 0)) {
    return Response.json({ error: 'Esta solicitação foi alterada por outra pessoa. Atualize e tente novamente.' }, { status: 409 });
  }

  return Response.json({
    item: {
      ...current,
      role: 'OPERATOR',
      active: nextActive,
      approval_status: nextStatus,
      updated_at: now,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
