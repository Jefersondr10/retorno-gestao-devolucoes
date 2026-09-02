import { appendSessionCookies, registerWithPassword, safeReturnPath, verifySameOriginRequest } from '@/lib/auth';
import { readBoundedJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!verifySameOriginRequest(request)) {
    return Response.json({ error: 'A solicitação não pôde ser validada.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const parsedBody = await readBoundedJsonObject(request, 16_384);
  if (!parsedBody.ok) return Response.json({ error: parsedBody.error }, { status: parsedBody.status, headers: { 'Cache-Control': 'no-store' } });
  const body = parsedBody.value;
  if (
    typeof body.displayName !== 'string'
    || typeof body.organizationName !== 'string'
    || typeof body.username !== 'string'
    || typeof body.password !== 'string'
  ) {
    return Response.json({ error: 'Preencha os dados para criar sua conta.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  if (body.displayName.length > 100 || body.organizationName.length > 120 || body.username.length > 64 || body.password.length > 128) {
    return Response.json({ error: 'Confira o tamanho dos dados informados.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await registerWithPassword(request, {
    displayName: body.displayName,
    organizationName: body.organizationName,
    username: body.username,
    password: body.password,
  });
  if ('error' in result) {
    return Response.json({ error: result.error, code: result.code }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendSessionCookies(headers, request, result.session.sessionToken, result.session.csrfToken);
  const destination = safeReturnPath(typeof body.returnTo === 'string' ? body.returnTo : undefined);
  return new Response(JSON.stringify({ user: result.user, destination }), { status: 201, headers });
}
