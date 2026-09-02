import {
  appendSessionCookies,
  clearGoogleAuthRateLimit,
  consumeGoogleAuthRateLimit,
  safeReturnPath,
  verifySameOriginRequest,
} from '@/lib/auth';
import {
  appendClearedGoogleNonceCookies,
  appendGoogleOnboardingCookie,
  authenticateWithGoogle,
  consumeGoogleNonceFromRequest,
} from '@/lib/google-auth';
import { readBoundedJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

function jsonResponse(body: unknown, status: number, clearNonce = true) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (clearNonce) appendClearedGoogleNonceCookies(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(request: Request) {
  if (!verifySameOriginRequest(request)) {
    return jsonResponse({ error: 'A solicitação não pôde ser validada.', code: 'ORIGIN_INVALID' }, 403);
  }
  const rateLimit = await consumeGoogleAuthRateLimit(request, 'login');
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', code: 'RATE_LIMITED' },
      429,
    );
  }

  const parsedBody = await readBoundedJsonObject(request, 32_768);
  if (!parsedBody.ok) return jsonResponse({ error: parsedBody.error, code: parsedBody.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' }, parsedBody.status);
  const body = parsedBody.value;
  if (
    typeof body.credential !== 'string'
    || body.credential.length < 100
    || body.credential.length > 24_000
    || (body.returnTo !== undefined && typeof body.returnTo !== 'string')
  ) {
    return jsonResponse(
      { error: 'Não foi possível receber os dados da conta Google.', code: 'GOOGLE_CREDENTIAL_MISSING' },
      422,
    );
  }
  const expectedNonce = await consumeGoogleNonceFromRequest(request);
  if (!expectedNonce) {
    return jsonResponse(
      { error: 'Esta tentativa de login expirou. Tente novamente.', code: 'GOOGLE_CHALLENGE_EXPIRED' },
      400,
    );
  }

  const result = await authenticateWithGoogle(body.credential, expectedNonce, request);
  if (result.kind === 'error') {
    return jsonResponse({ error: result.error, code: result.code }, result.status);
  }
  if (result.kind === 'onboarding') {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    appendClearedGoogleNonceCookies(headers);
    appendGoogleOnboardingCookie(headers, request, result.onboardingToken);
    return new Response(JSON.stringify({
      onboarding: true,
      destination: `/cadastro?google=1&returnTo=${encodeURIComponent(safeReturnPath(typeof body.returnTo === 'string' ? body.returnTo : undefined))}`,
      email: result.email,
      displayName: result.displayName,
    }), { status: 202, headers });
  }

  await clearGoogleAuthRateLimit(rateLimit.subjectHash);

  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendClearedGoogleNonceCookies(headers);
  appendSessionCookies(headers, request, result.session.sessionToken, result.session.csrfToken);
  const destination = safeReturnPath(typeof body.returnTo === 'string' ? body.returnTo : undefined);
  return new Response(JSON.stringify({ user: result.user, destination }), { status: 200, headers });
}
