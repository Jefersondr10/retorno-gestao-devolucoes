import {
  actorLabel,
  appendSessionCookies,
  authenticateApi,
  consumePasswordChangeRateLimit,
  createSession,
  hashPassword,
  validatePassword,
  verifyPassword,
} from '@/lib/auth';
import { getBindings } from '@/lib/data';
import { readBoundedJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticateApi(request, { allowPasswordChange: true });
  if ('response' in auth) return auth.response;
  const parsedBody = await readBoundedJsonObject(request, 8_192);
  if (!parsedBody.ok) return Response.json({ error: parsedBody.error }, { status: parsedBody.status, headers: { 'Cache-Control': 'no-store' } });
  const body = parsedBody.value;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (currentPassword.length > 128) {
    return Response.json({ error: 'A senha atual está incorreta.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) return Response.json({ error: passwordError }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  if (currentPassword === newPassword) {
    return Response.json({ error: 'Escolha uma senha diferente da atual.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }

  const { db } = getBindings();
  const current = await db
    .prepare(`SELECT password_hash, password_salt, password_iterations
      FROM users
      WHERE id = ? AND active = 1 AND password_login_enabled = 1`)
    .bind(auth.user.id)
    .first<{ password_hash: string; password_salt: string; password_iterations: number }>();
  const passwordRateLimit = await consumePasswordChangeRateLimit(auth.user.id);
  if (!passwordRateLimit.allowed) {
    return Response.json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!current || !(await verifyPassword(currentPassword, current))) {
    return Response.json({ error: 'A senha atual está incorreta.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }

  const password = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?,
          must_change_password = 0, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(password.hash, password.salt, password.iterations, now, auth.user.id),
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(auth.user.id),
    db.prepare('DELETE FROM auth_rate_limits WHERE subject_hash = ?').bind(passwordRateLimit.subjectHash),
    db
      .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'PASSWORD_CHANGED', ?, ?)")
      .bind(crypto.randomUUID(), auth.user.organizationId, actorLabel(auth.user), JSON.stringify({ userId: auth.user.id }), now),
  ]);
  const session = await createSession(auth.user.id, auth.user.organizationId);
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendSessionCookies(headers, request, session.sessionToken, session.csrfToken);
  return new Response(JSON.stringify({ ok: true, destination: '/' }), { headers });
}
