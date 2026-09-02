import { appendSessionCookies, login, safeReturnPath, verifySameOriginRequest } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!verifySameOriginRequest(request)) {
    return Response.json({ error: 'A solicitação não pôde ser validada.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const parsedBody = await readBoundedJsonObject(request, 8_192);
  if (!parsedBody.ok) return Response.json({ error: parsedBody.error }, { status: parsedBody.status, headers: { 'Cache-Control': 'no-store' } });
  const body = parsedBody.value;
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return Response.json({ error: 'Informe o usuário e a senha.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  if (body.username.length > 64 || body.password.length > 128) {
    return Response.json({ error: 'Usuário ou senha inválidos.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await login(request, body.username, body.password);
  if ('error' in result) {
    return Response.json({ error: result.error, code: result.code }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendSessionCookies(headers, request, result.session.sessionToken, result.session.csrfToken);
  const destination = result.user.mustChangePassword ? '/alterar-senha' : safeReturnPath(typeof body.returnTo === 'string' ? body.returnTo : undefined);
  return new Response(JSON.stringify({ user: result.user, destination }), { status: 200, headers });
}
