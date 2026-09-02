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

type ManagedMembership = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  active: number;
  must_change_password: number;
  membership_updated_at: string;
  user_updated_at: string;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  password_login_enabled: number;
  provider: 'PASSWORD' | 'GOOGLE';
  google_email: string | null;
  membership_count: number;
};

async function readMembership(db: D1Database, organizationId: string, userId: string) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, m.role,
    CASE WHEN m.status = 'ACTIVE' THEN 1 ELSE 0 END AS active,
    u.must_change_password, m.updated_at AS membership_updated_at, u.updated_at AS user_updated_at,
    CASE m.status WHEN 'PENDING' THEN 'PENDING' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'APPROVED' END AS approval_status,
    u.password_login_enabled,
    CASE WHEN u.google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider,
    u.google_email,
    (SELECT COUNT(*) FROM organization_memberships all_memberships WHERE all_memberships.user_id = u.id) AS membership_count
    FROM organization_memberships m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ? AND m.user_id = ?`)
    .bind(organizationId, userId)
    .first<ManagedMembership>();
}

function publicItem(record: ManagedMembership) {
  return {
    id: record.id,
    username: record.username,
    display_name: record.display_name,
    role: record.role,
    active: record.active,
    must_change_password: record.must_change_password,
    updated_at: record.membership_updated_at,
    approval_status: record.approval_status,
    google_email: record.google_email,
    password_login_enabled: record.password_login_enabled,
    provider: record.provider,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authenticateApi(request, { roles: ['ADMIN'] });
  if ('response' in auth) return auth.response;
  await ensureSchema();
  const { id } = await context.params;
  const parsed = await request.json().catch(() => null) as unknown;
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { displayName?: unknown; role?: unknown; active?: unknown; temporaryPassword?: unknown }
    : {};
  if (body.displayName !== undefined && typeof body.displayName !== 'string') return Response.json({ error: 'Informe um nome válido.' }, { status: 422 });
  if (body.role !== undefined && typeof body.role !== 'string') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (body.active !== undefined && typeof body.active !== 'boolean') return Response.json({ error: 'Informe se o usuário está ativo ou inativo.' }, { status: 422 });
  if (body.temporaryPassword !== undefined && typeof body.temporaryPassword !== 'string') return Response.json({ error: 'Informe uma senha temporária válida.' }, { status: 422 });

  const { db } = getBindings();
  const current = await readMembership(db, auth.user.organizationId, id);
  if (!current) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  const displayName = body.displayName === undefined ? current.display_name : body.displayName.trim();
  const role = body.role === undefined ? current.role : body.role as UserRole;
  const active = body.active === undefined ? current.active : body.active ? 1 : 0;
  const temporaryPassword = body.temporaryPassword || '';
  if (!displayName || displayName.length > 100) return Response.json({ error: 'Informe um nome com até 100 caracteres.' }, { status: 422 });
  if (role !== 'ADMIN' && role !== 'OPERATOR') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (id === auth.user.id && active === 0) return Response.json({ error: 'Você não pode inativar o próprio acesso.' }, { status: 409 });
  if (id === auth.user.id && role !== current.role) return Response.json({ error: 'Outro administrador deve alterar o seu perfil.' }, { status: 409 });
  if (temporaryPassword && current.password_login_enabled !== 1) return Response.json({ error: 'Esta conta usa somente o Google e não possui senha local.' }, { status: 409 });
  if (id === auth.user.id && temporaryPassword) return Response.json({ error: 'Use “Trocar minha senha” no menu da sua conta.' }, { status: 409 });
  if ((temporaryPassword || displayName !== current.display_name) && current.membership_count > 1) {
    return Response.json({ error: 'Este usuário participa de mais de uma empresa. Somente ele pode alterar seus dados de acesso.' }, { status: 409 });
  }
  if (temporaryPassword) {
    const passwordError = validatePassword(temporaryPassword);
    if (passwordError) return Response.json({ error: passwordError }, { status: 422 });
  }

  const password = temporaryPassword ? await hashPassword(temporaryPassword) : null;
  const now = new Date().toISOString();
  const nextStatus = active ? 'ACTIVE' : 'SUSPENDED';
  const updatesIdentity = Boolean(password || displayName !== current.display_name);
  const membershipSql = updatesIdentity
    ? `UPDATE organization_memberships SET role = ?, status = ?, updated_at = ?
      WHERE organization_id = ? AND user_id = ? AND role = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM users target
          WHERE target.id = ? AND target.updated_at = ?
            AND (SELECT COUNT(*) FROM organization_memberships all_memberships WHERE all_memberships.user_id = target.id) = 1
        )`
    : `UPDATE organization_memberships SET role = ?, status = ?, updated_at = ?
      WHERE organization_id = ? AND user_id = ? AND role = ? AND updated_at = ?`;
  const operations: D1PreparedStatement[] = [
    updatesIdentity
      ? db.prepare(membershipSql).bind(
        role, nextStatus, now, auth.user.organizationId, id, current.role, current.membership_updated_at,
        id, current.user_updated_at,
      )
      : db.prepare(membershipSql).bind(role, nextStatus, now, auth.user.organizationId, id, current.role, current.membership_updated_at),
  ];
  if (password) {
    operations.push(db.prepare(`UPDATE users SET display_name = ?, password_hash = ?, password_salt = ?,
      password_iterations = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(displayName, password.hash, password.salt, password.iterations, now, id, current.user_updated_at, auth.user.organizationId, id, now));
  } else if (displayName !== current.display_name) {
    operations.push(db.prepare(`UPDATE users SET display_name = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(displayName, now, id, current.user_updated_at, auth.user.organizationId, id, now));
  }
  operations.push(
    db.prepare(`INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
      SELECT ?, ?, NULL, ?, 'USER_UPDATED', ?, ?
      WHERE EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(
        crypto.randomUUID(), auth.user.organizationId, actorLabel(auth.user),
        JSON.stringify({ userId: id, username: current.username, previousRole: current.role, role, previousActive: current.active, active, passwordReset: Boolean(password) }),
        now, auth.user.organizationId, id, now,
      ),
  );
  if (role !== current.role || active !== current.active) {
    operations.push(db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND organization_id = ?').bind(id, auth.user.organizationId));
  }
  if (password) {
    const rateLimitHashes = await userAuthenticationRateLimitHashes(id);
    operations.push(
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM auth_rate_limits WHERE subject_hash IN (?, ?)').bind(rateLimitHashes.account, rateLimitHashes.passwordChange),
    );
  }

  try {
    const [membershipUpdate, identityUpdate] = await db.batch(operations);
    if (!Number(membershipUpdate.meta.changes || 0)) {
      return Response.json({ error: 'Este acesso foi alterado por outra pessoa. Atualize e tente novamente.' }, { status: 409 });
    }
    if (updatesIdentity && !Number(identityUpdate?.meta.changes || 0)) {
      return Response.json({ error: 'Os dados deste usuário foram alterados em outro ambiente. Atualize e tente novamente.' }, { status: 409 });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('LAST_ACTIVE_ADMIN')) {
      return Response.json({ error: 'Mantenha pelo menos um administrador ativo.' }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes('idx_memberships_one_active_org')) {
      return Response.json({ error: 'Este usuário já possui acesso ativo em outra empresa.' }, { status: 409 });
    }
    throw error;
  }
  const updated = await readMembership(db, auth.user.organizationId, id);
  if (!updated) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  return Response.json({ item: publicItem(updated) }, { headers: { 'Cache-Control': 'no-store' } });
}
