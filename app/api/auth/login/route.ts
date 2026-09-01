import { appendSessionCookies, login, safeReturnPath, verifySameOriginRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!verifySameOriginRequest(request)) {
    return Response.json({ error: 'A solicitação não pôde ser validada.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return Response.json({ error: 'A solicitação ficou grande demais.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 8_192) {
    return Response.json({ error: 'A solicitação ficou grande demais.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = (() => {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as { username?: unknown; password?: unknown; returnTo?: unknown }
        : {};
    } catch {
      return {};
    }
  })();
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
