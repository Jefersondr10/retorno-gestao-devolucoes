import {
  actorLabel,
  authenticateApi,
  hashPassword,
  userAuthenticationRateLimitHashes,
  validatePassword,
  type UserRole,
} from '@/lib/auth';
import { ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authenticateApi(request, { roles: ['ADMIN'] });
  if ('response' in auth) return auth.response;
  await ensureSchema();
  const { id } = await context.params;
  const parsed = await request.json().catch(() => null) as unknown;
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { displayName?: unknown; role?: unknown; active?: unknown; temporaryPassword?: unknown }
    : {};
  if (body.displayName !== undefined && typeof body.displayName !== 'string') {
    return Response.json({ error: 'Informe um nome válido.' }, { status: 422 });
  }
  if (body.role !== undefined && typeof body.role !== 'string') {
    return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  }
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return Response.json({ error: 'Informe se o usuário está ativo ou inativo.' }, { status: 422 });
  }
  if (body.temporaryPassword !== undefined && typeof body.temporaryPassword !== 'string') {
    return Response.json({ error: 'Informe uma senha temporária válida.' }, { status: 422 });
  }
  const { db } = getBindings();
  const current = await db
    .prepare(`SELECT id, username, display_name, role, active, must_change_password, updated_at,
      approval_status, password_login_enabled,
      CASE WHEN google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider,
      google_email
      FROM users WHERE id = ?`)
    .bind(id)
    .first<{
      id: string;
      username: string;
      display_name: string;
      role: UserRole;
      active: number;
      must_change_password: number;
      updated_at: string;
      approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
      password_login_enabled: number;
      provider: 'PASSWORD' | 'GOOGLE';
      google_email: string | null;
    }>();
  if (!current) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });

  const displayName = body.displayName === undefined ? current.display_name : body.displayName.trim();
  const role = body.role === undefined ? current.role : body.role as UserRole;
  const active = body.active === undefined ? current.active : body.active ? 1 : 0;
  if (!displayName || displayName.length > 100) return Response.json({ error: 'Informe um nome com até 100 caracteres.' }, { status: 422 });
  if (role !== 'ADMIN' && role !== 'OPERATOR') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (id === auth.user.id && active === 0) return Response.json({ error: 'Você não pode inativar a própria conta.' }, { status: 409 });
  if (id === auth.user.id && role !== current.role) return Response.json({ error: 'Outro administrador deve alterar o seu perfil.' }, { status: 409 });

  const temporaryPassword = body.temporaryPassword || '';
  if (current.approval_status !== 'APPROVED' && (body.role !== undefined || body.active !== undefined || temporaryPassword)) {
    return Response.json({ error: 'Aprove ou recuse esta solicitação antes de editar o acesso.' }, { status: 409 });
  }
  if (temporaryPassword && current.password_login_enabled !== 1) {
    return Response.json({ error: 'Esta conta usa somente o login do Google e não possui senha local.' }, { status: 409 });
  }
  if (id === auth.user.id && temporaryPassword) {
    return Response.json({ error: 'Use “Trocar minha senha” no menu da sua conta.' }, { status: 409 });
  }
  if (temporaryPassword) {
    const passwordError = validatePassword(temporaryPassword);
    if (passwordError) return Response.json({ error: passwordError }, { status: 422 });
  }
  const password = temporaryPassword ? await hashPassword(temporaryPassword) : null;
  const now = new Date().toISOString();
  const roleOrActiveChanged = role !== current.role || active !== current.active;
  const adminGuard = `AND (
    users.role <> 'ADMIN'
    OR users.active <> 1
    OR users.approval_status <> 'APPROVED'
    OR (? = 'ADMIN' AND ? = 1)
    OR EXISTS (
      SELECT 1 FROM users AS other
      WHERE other.id <> users.id AND other.role = 'ADMIN' AND other.active = 1
        AND other.approval_status = 'APPROVED'
    )
  )`;
  const updateStatement = password
    ? db
        .prepare(
          `UPDATE users SET display_name = ?, role = ?, active = ?, password_hash = ?, password_salt = ?,
            password_iterations = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?
           WHERE id = ? AND role = ? AND active = ? AND updated_at = ? ${adminGuard}`,
        )
        .bind(
          displayName, role, active, password.hash, password.salt, password.iterations, now,
          id, current.role, current.active, current.updated_at, role, active,
        )
    : db
        .prepare(
          `UPDATE users SET display_name = ?, role = ?, active = ?, updated_at = ?
           WHERE id = ? AND role = ? AND active = ? AND updated_at = ? ${adminGuard}`,
        )
        .bind(displayName, role, active, now, id, current.role, current.active, current.updated_at, role, active);
  const successGuard = `EXISTS (
    SELECT 1 FROM users
    WHERE id = ? AND updated_at = ? AND display_name = ? AND role = ? AND active = ?
  )`;
  const auditDetails = JSON.stringify({
    userId: id,
    username: current.username,
    previousRole: current.role,
    role,
    previousActive: current.active,
    active,
    passwordReset: Boolean(password),
  });
  const operations: D1PreparedStatement[] = [
    updateStatement,
    db
      .prepare(
        `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
         SELECT ?, NULL, ?, 'USER_UPDATED', ?, ? WHERE ${successGuard}`,
      )
      .bind(crypto.randomUUID(), actorLabel(auth.user), auditDetails, now, id, now, displayName, role, active),
  ];
  if (roleOrActiveChanged || password) {
    operations.push(
      db
        .prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND ${successGuard}`)
        .bind(id, id, now, displayName, role, active),
    );
  }
  if (password) {
    const rateLimitHashes = await userAuthenticationRateLimitHashes(id);
    operations.push(
      db
        .prepare(`DELETE FROM auth_rate_limits WHERE subject_hash IN (?, ?) AND ${successGuard}`)
        .bind(rateLimitHashes.account, rateLimitHashes.passwordChange, id, now, displayName, role, active),
    );
  }
  const [updateResult] = await db.batch(operations);
  if (!Number(updateResult.meta.changes || 0)) {
    const exists = await db.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
    if (!exists) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    const removesAdmin = current.role === 'ADMIN' && current.active === 1 && (role !== 'ADMIN' || active === 0);
    return Response.json(
      { error: removesAdmin ? 'Mantenha pelo menos um administrador ativo.' : 'Este usuário foi alterado por outra pessoa. Atualize e tente novamente.' },
      { status: 409 },
    );
  }
  const updated = await db
    .prepare(`SELECT id, username, display_name, role, active, must_change_password, updated_at,
      approval_status, google_email, password_login_enabled,
      CASE WHEN google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider
      FROM users WHERE id = ?`)
    .bind(id)
    .first<{
      id: string;
      username: string;
      display_name: string;
      role: UserRole;
      active: number;
      must_change_password: number;
      updated_at: string;
      approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
      google_email: string | null;
      password_login_enabled: number;
      provider: 'PASSWORD' | 'GOOGLE';
    }>();
  if (!updated) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  return Response.json({
    item: updated,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
