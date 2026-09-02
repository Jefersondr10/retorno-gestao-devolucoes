import { appendSessionCookies, safeReturnPath, verifySameOriginRequest } from '@/lib/auth';
import {
  appendClearedGoogleOnboardingCookies,
  completeGoogleOnboarding,
  getGoogleOnboarding,
} from '@/lib/google-auth';
import { readBoundedJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const onboarding = await getGoogleOnboarding(request);
  if (!onboarding) {
    return Response.json({ error: 'Esta criação de conta expirou.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ item: onboarding }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!verifySameOriginRequest(request)) {
    return Response.json({ error: 'A solicitação não pôde ser validada.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!(await getGoogleOnboarding(request))) {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    appendClearedGoogleOnboardingCookies(headers);
    return new Response(JSON.stringify({ error: 'Esta criação de conta expirou.' }), { status: 404, headers });
  }
  const parsedBody = await readBoundedJsonObject(request, 8_192);
  if (!parsedBody.ok) return Response.json({ error: parsedBody.error }, { status: parsedBody.status, headers: { 'Cache-Control': 'no-store' } });
  const body = parsedBody.value;
  if (typeof body.organizationName !== 'string' || body.organizationName.length > 120) {
    return Response.json({ error: 'Informe o nome da empresa.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await completeGoogleOnboarding(request, body.organizationName);
  if (result.kind === 'error') {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (result.code === 'GOOGLE_ONBOARDING_EXPIRED') appendClearedGoogleOnboardingCookies(headers);
    return new Response(JSON.stringify({ error: result.error, code: result.code }), { status: result.status, headers });
  }
  if (result.kind !== 'authenticated') {
    return Response.json({ error: 'Não foi possível concluir o cadastro.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendClearedGoogleOnboardingCookies(headers);
  appendSessionCookies(headers, request, result.session.sessionToken, result.session.csrfToken);
  const destination = safeReturnPath(typeof body.returnTo === 'string' ? body.returnTo : undefined);
  return new Response(JSON.stringify({ user: result.user, destination }), { status: 201, headers });
}
