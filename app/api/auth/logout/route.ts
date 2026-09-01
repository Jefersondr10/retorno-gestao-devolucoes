import { actorLabel, appendClearedSessionCookies, authenticateApi } from '@/lib/auth';
import { getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticateApi(request, { allowPasswordChange: true });
  if ('response' in auth) return auth.response;
  const now = new Date().toISOString();
  const { db } = getBindings();
  await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(auth.session.tokenHash),
    db
      .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'LOGOUT', ?, ?)")
      .bind(crypto.randomUUID(), actorLabel(auth.user), JSON.stringify({ userId: auth.user.id }), now),
  ]);
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendClearedSessionCookies(headers, request);
  return new Response(JSON.stringify({ ok: true }), { headers });
}
