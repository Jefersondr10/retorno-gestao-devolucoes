import {
  actorLabel,
  authenticateApi,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  type UserRole,
} from '@/lib/auth';
import { ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateApi(request, { roles: ['ADMIN'], csrf: false });
  if ('response' in auth) return auth.response;
  await ensureSchema();
  const { db } = getBindings();
  const result = await db
    .prepare(
      `SELECT id, username, display_name, role, active, must_change_password,
        last_login_at, created_at, updated_at, approval_status, google_email,
        password_login_enabled,
        CASE WHEN google_sub IS NULL THEN 'PASSWORD' ELSE 'GOOGLE' END AS provider
       FROM users
       ORDER BY CASE approval_status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
         active DESC, display_name COLLATE NOCASE`,
    )
    .all();
  return Response.json({ items: result.results }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const auth = await authenticateApi(request, { roles: ['ADMIN'] });
  if ('response' in auth) return auth.response;
  const parsed = await request.json().catch(() => null) as unknown;
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { username?: unknown; displayName?: unknown; role?: unknown; temporaryPassword?: unknown }
    : {};
  if (
    typeof body.username !== 'string'
    || typeof body.displayName !== 'string'
    || typeof body.role !== 'string'
    || typeof body.temporaryPassword !== 'string'
  ) {
    return Response.json({ error: 'Preencha nome, usuário, perfil e senha temporária.' }, { status: 422 });
  }
  const username = normalizeUsername(body.username);
  const displayName = body.displayName.trim();
  const role = body.role as UserRole;
  const temporaryPassword = body.temporaryPassword;
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(temporaryPassword);
  if (usernameError) return Response.json({ error: usernameError }, { status: 422 });
  if (!displayName || displayName.length > 100) return Response.json({ error: 'Informe um nome com até 100 caracteres.' }, { status: 422 });
  if (role !== 'ADMIN' && role !== 'OPERATOR') return Response.json({ error: 'Selecione um perfil válido.' }, { status: 422 });
  if (passwordError) return Response.json({ error: passwordError }, { status: 422 });

  await ensureSchema();
  const { db } = getBindings();
  const duplicate = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (duplicate) return Response.json({ error: 'Já existe um usuário com esse identificador.' }, { status: 409 });
  const password = await hashPassword(temporaryPassword);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
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
      .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'USER_CREATED', ?, ?)")
      .bind(crypto.randomUUID(), actorLabel(auth.user), JSON.stringify({ userId: id, username, displayName, role }), now),
  ]);
  return Response.json(
    {
      item: {
        id,
        username,
        display_name: displayName,
        role,
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
