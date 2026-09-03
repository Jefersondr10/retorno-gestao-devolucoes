import {
  actorLabel,
  authenticateApi,
  hashPassword,
  userAuthenticationRateLimitHashes,
  validatePassword,
  type UserRole,
} from '@/lib/auth';
import { ensureSchema, getBindings } from '@/lib/data';
import {
  DEFAULT_OPERATOR_PERMISSIONS,
  effectiveUserPermissions,
  isUserPermission,
  normalizeUserPermissions,
  parseStoredPermissions,
  USER_PERMISSIONS,
  type UserPermission,
} from '@/lib/permissions';
import { readBoundedJsonObject } from '@/lib/request-body';

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
  permissions_json: string;
};

async function readMembership(db: D1Database, organizationId: string, userId: string) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, m.role,
    CASE WHEN m.status = 'ACTIVE' THEN 1 ELSE 0 END AS active,
    u.must_change_password, m.updated_at AS membership_updated_at, u.updated_at AS user_updated_at,
    CASE m.status WHEN 'PENDING' THEN 'PENDING' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'APPROVED' END AS approval_status,
    u.password_login_enabled,
    CASE WHEN u.google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider,
    u.google_email,
    (SELECT COUNT(*) FROM organization_memberships all_memberships WHERE all_memberships.user_id = u.id) AS membership_count,
    COALESCE((SELECT json_group_array(p.permission)
      FROM organization_membership_permissions p
      WHERE p.organization_id = m.organization_id AND p.user_id = m.user_id), '[]') AS permissions_json
    FROM organization_memberships m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ? AND m.user_id = ?`)
    .bind(organizationId, userId)
    .first<ManagedMembership>();
}

function currentPermissions(record: ManagedMembership) {
  return effectiveUserPermissions({
    role: record.role,
    permissions: parseStoredPermissions(record.permissions_json),
  });
}

function publicItem(record: ManagedMembership) {
  return {
    id: record.id,
    username: record.username,
    display_name: record.display_name,
    role: record.role,
    permissions: currentPermissions(record),
    active: record.active,
    must_change_password: record.must_change_password,
    updated_at: record.membership_updated_at,
    approval_status: record.approval_status,
    google_email: record.google_email,
    password_login_enabled: record.password_login_enabled,
    provider: record.provider,
  };
}

function invalidPermissionPayload(value: unknown) {
  return value !== undefined && (!Array.isArray(value) || value.some((permission) => !isUserPermission(permission)));
}

function managerCanGrant(manager: { role: UserRole; permissions: UserPermission[] }, role: UserRole, permissions: readonly UserPermission[]) {
  if (manager.role === 'ADMIN') return true;
  if (role === 'ADMIN' || permissions.includes('team.manage')) return false;
  return permissions.every((permission) => manager.permissions.includes(permission));
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authenticateApi(request, { permission: 'team.manage' });
  if ('response' in auth) return auth.response;
  await ensureSchema();
  const { id } = await context.params;
  const parsed = await readBoundedJsonObject(request, 32_768);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (body.displayName !== undefined && typeof body.displayName !== 'string') return Response.json({ error: 'Informe um nome válido.' }, { status: 422 });
  if (body.role !== undefined && typeof body.role !== 'string') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (body.active !== undefined && typeof body.active !== 'boolean') return Response.json({ error: 'Informe se o usuário está ativo ou inativo.' }, { status: 422 });
  if (body.temporaryPassword !== undefined && typeof body.temporaryPassword !== 'string') return Response.json({ error: 'Informe uma senha temporária válida.' }, { status: 422 });
  if (invalidPermissionPayload(body.permissions)) return Response.json({ error: 'Selecione apenas acessos válidos.' }, { status: 422 });

  const { db } = getBindings();
  const current = await readMembership(db, auth.user.organizationId, id);
  if (!current) return Response.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  const previousPermissions = currentPermissions(current);
  const displayName = body.displayName === undefined ? current.display_name : body.displayName.trim();
  const role = body.role === undefined ? current.role : body.role as UserRole;
  const active = body.active === undefined ? current.active : body.active ? 1 : 0;
  const temporaryPassword = typeof body.temporaryPassword === 'string' ? body.temporaryPassword : '';
  const permissions = role === 'ADMIN'
    ? [...USER_PERMISSIONS]
    : normalizeUserPermissions(
      body.permissions,
      current.role === 'OPERATOR' ? previousPermissions : DEFAULT_OPERATOR_PERMISSIONS,
    );
  const permissionsChanged = permissions.join('|') !== previousPermissions.join('|');

  if (!displayName || displayName.length > 100) return Response.json({ error: 'Informe um nome com até 100 caracteres.' }, { status: 422 });
  if (role !== 'ADMIN' && role !== 'OPERATOR') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (role === 'OPERATOR' && permissions.length === 0) return Response.json({ error: 'Marque pelo menos um acesso para este usuário.' }, { status: 422 });
  if (auth.user.role !== 'ADMIN' && (current.role === 'ADMIN' || previousPermissions.includes('team.manage'))) {
    return Response.json({ error: 'Somente um administrador pode alterar este acesso.' }, { status: 403 });
  }
  if (!managerCanGrant(auth.user, role, permissions)) {
    return Response.json({ error: 'Você não pode conceder um acesso superior ao seu.' }, { status: 403 });
  }
  if (id === auth.user.id && active === 0) return Response.json({ error: 'Você não pode inativar o próprio acesso.' }, { status: 409 });
  if (id === auth.user.id && (role !== current.role || permissionsChanged)) {
    return Response.json({ error: 'Outro administrador deve alterar os seus acessos.' }, { status: 409 });
  }
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
  const mutationMarker = `${now}|${crypto.randomUUID()}`;
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
        role, nextStatus, mutationMarker, auth.user.organizationId, id, current.role, current.membership_updated_at,
        id, current.user_updated_at,
      )
      : db.prepare(membershipSql).bind(role, nextStatus, mutationMarker, auth.user.organizationId, id, current.role, current.membership_updated_at),
  ];
  if (password) {
    operations.push(db.prepare(`UPDATE users SET display_name = ?, password_hash = ?, password_salt = ?,
      password_iterations = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(displayName, password.hash, password.salt, password.iterations, now, id, current.user_updated_at, auth.user.organizationId, id, mutationMarker));
  } else if (displayName !== current.display_name) {
    operations.push(db.prepare(`UPDATE users SET display_name = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(displayName, now, id, current.user_updated_at, auth.user.organizationId, id, mutationMarker));
  }

  operations.push(
    db.prepare(`DELETE FROM organization_membership_permissions
      WHERE organization_id = ? AND user_id = ?
        AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(auth.user.organizationId, id, auth.user.organizationId, id, mutationMarker),
  );
  if (role === 'OPERATOR') {
    for (const permission of permissions) {
      operations.push(
        db.prepare(`INSERT INTO organization_membership_permissions
          (organization_id, user_id, permission, created_at)
          SELECT ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
          .bind(auth.user.organizationId, id, permission, now, auth.user.organizationId, id, mutationMarker),
      );
    }
  }
  operations.push(
    db.prepare(`INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
      SELECT ?, ?, NULL, ?, 'USER_UPDATED', ?, ?
      WHERE EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(
        crypto.randomUUID(),
        auth.user.organizationId,
        actorLabel(auth.user),
        JSON.stringify({
          userId: id,
          username: current.username,
          previousRole: current.role,
          role,
          previousPermissions,
          permissions,
          previousActive: current.active,
          active,
          passwordReset: Boolean(password),
        }),
        now,
        auth.user.organizationId,
        id,
        mutationMarker,
      ),
  );
  if (role !== current.role || active !== current.active || permissionsChanged) {
    operations.push(db.prepare(`DELETE FROM auth_sessions
      WHERE user_id = ? AND organization_id = ?
        AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
      .bind(id, auth.user.organizationId, auth.user.organizationId, id, mutationMarker));
  }
  if (password) {
    const rateLimitHashes = await userAuthenticationRateLimitHashes(id);
    operations.push(
      db.prepare(`DELETE FROM auth_sessions
        WHERE user_id = ?
          AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
        .bind(id, auth.user.organizationId, id, mutationMarker),
      db.prepare(`DELETE FROM auth_rate_limits
        WHERE subject_hash IN (?, ?)
          AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND updated_at = ?)`)
        .bind(rateLimitHashes.account, rateLimitHashes.passwordChange, auth.user.organizationId, id, mutationMarker),
    );
  }

  try {
    const results = await db.batch(operations);
    const membershipUpdate = results[0];
    const identityUpdate = updatesIdentity ? results[1] : null;
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
