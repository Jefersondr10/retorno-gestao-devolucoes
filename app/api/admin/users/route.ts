import {
  actorLabel,
  authenticateApi,
  hashPassword,
  isReservedBootstrapUsername,
  normalizeUsername,
  validatePassword,
  validateUsername,
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

type ManagedUserRecord = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  approval_status: 'APPROVED' | 'PENDING' | 'REJECTED';
  google_email: string | null;
  password_login_enabled: number;
  provider: 'GOOGLE' | 'PASSWORD';
  permissions_json: string;
};

function publicItem(record: ManagedUserRecord) {
  return {
    ...record,
    permissions: effectiveUserPermissions({
      role: record.role,
      permissions: parseStoredPermissions(record.permissions_json),
    }),
    permissions_json: undefined,
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

export async function GET(request: Request) {
  const auth = await authenticateApi(request, { permission: 'team.manage', csrf: false });
  if ('response' in auth) return auth.response;
  await ensureSchema();
  const { db } = getBindings();
  const [result, activities] = await Promise.all([
    db
      .prepare(
        `SELECT id, username, display_name, role, active, must_change_password,
          last_login_at, created_at, updated_at, approval_status, google_email,
          password_login_enabled, provider, permissions_json
         FROM (
           SELECT u.id, u.username, u.display_name, m.role,
             CASE WHEN m.status = 'ACTIVE' THEN 1 ELSE 0 END AS active,
             u.must_change_password, u.last_login_at, m.created_at, m.updated_at,
             CASE m.status WHEN 'PENDING' THEN 'PENDING' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'APPROVED' END AS approval_status,
             u.google_email, u.password_login_enabled,
             CASE WHEN u.google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider,
             COALESCE((SELECT json_group_array(p.permission)
               FROM organization_membership_permissions p
               WHERE p.organization_id = m.organization_id AND p.user_id = m.user_id), '[]') AS permissions_json
           FROM organization_memberships m
           INNER JOIN users u ON u.id = m.user_id
           WHERE m.organization_id = ? AND m.status IN ('ACTIVE', 'SUSPENDED')
         )
         ORDER BY active DESC, display_name COLLATE NOCASE`,
      )
      .bind(auth.user.organizationId)
      .all<ManagedUserRecord>(),
    db
      .prepare(`SELECT id, actor, action, details, created_at
        FROM audit_events
        WHERE organization_id = ? AND action IN ('USER_CREATED', 'USER_UPDATED')
        ORDER BY created_at DESC, id DESC
        LIMIT 20`)
      .bind(auth.user.organizationId)
      .all(),
  ]);
  return Response.json(
    { items: result.results.map(publicItem), activities: activities.results },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = await authenticateApi(request, { permission: 'team.manage' });
  if ('response' in auth) return auth.response;
  const parsed = await readBoundedJsonObject(request, 32_768);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (
    typeof body.username !== 'string'
    || typeof body.displayName !== 'string'
    || typeof body.temporaryPassword !== 'string'
    || (body.role !== undefined && typeof body.role !== 'string')
    || invalidPermissionPayload(body.permissions)
  ) {
    return Response.json({ error: 'Preencha nome, usuário, senha temporária e acessos.' }, { status: 422 });
  }
  const username = normalizeUsername(body.username);
  const displayName = body.displayName.trim();
  const role = (body.role || 'OPERATOR') as UserRole;
  const temporaryPassword = body.temporaryPassword;
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(temporaryPassword);
  if (usernameError) return Response.json({ error: usernameError }, { status: 422 });
  if (isReservedBootstrapUsername(username)) return Response.json({ error: 'Esse nome de usuário não está disponível.' }, { status: 409 });
  if (!displayName || displayName.length > 100) return Response.json({ error: 'Informe um nome com até 100 caracteres.' }, { status: 422 });
  if (role !== 'ADMIN' && role !== 'OPERATOR') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (passwordError) return Response.json({ error: passwordError }, { status: 422 });

  const permissions = role === 'ADMIN'
    ? [...USER_PERMISSIONS]
    : normalizeUserPermissions(body.permissions, DEFAULT_OPERATOR_PERMISSIONS);
  if (role === 'OPERATOR' && permissions.length === 0) {
    return Response.json({ error: 'Marque pelo menos um acesso para este usuário.' }, { status: 422 });
  }
  if (!managerCanGrant(auth.user, role, permissions)) {
    return Response.json({ error: 'Você não pode conceder um acesso superior ao seu.' }, { status: 403 });
  }

  await ensureSchema();
  const { db } = getBindings();
  const duplicate = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (duplicate) return Response.json({ error: 'Já existe um usuário com esse identificador.' }, { status: 409 });
  const password = await hashPassword(temporaryPassword);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
           (id, username, display_name, password_hash, password_salt, password_iterations, role, active,
            must_change_password, failed_attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`,
        )
        .bind(id, username, displayName, password.hash, password.salt, password.iterations, role, now, now),
      db
        .prepare(`INSERT INTO organization_memberships
          (organization_id, user_id, role, status, created_at, updated_at)
          VALUES (?, ?, ?, 'ACTIVE', ?, ?)`)
        .bind(auth.user.organizationId, id, role, now, now),
      ...permissions
        .filter(() => role === 'OPERATOR')
        .map((permission) => db.prepare(`INSERT INTO organization_membership_permissions
          (organization_id, user_id, permission, created_at) VALUES (?, ?, ?, ?)`)
          .bind(auth.user.organizationId, id, permission, now)),
      db
        .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'USER_CREATED', ?, ?)")
        .bind(
          crypto.randomUUID(),
          auth.user.organizationId,
          actorLabel(auth.user),
          JSON.stringify({ userId: id, username, displayName, role, permissions }),
          now,
        ),
    ]);
  } catch (error) {
    if (await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) {
      return Response.json({ error: 'Já existe um usuário com esse identificador.' }, { status: 409 });
    }
    throw error;
  }
  return Response.json(
    {
      item: {
        id,
        username,
        display_name: displayName,
        role,
        permissions,
        active: 1,
        must_change_password: 1,
        last_login_at: null,
        created_at: now,
        updated_at: now,
        approval_status: 'APPROVED',
        google_email: null,
        password_login_enabled: 1,
        provider: 'PASSWORD',
      },
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
