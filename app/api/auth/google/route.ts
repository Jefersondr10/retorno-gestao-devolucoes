import {
  appendSessionCookies,
  clearGoogleAuthRateLimit,
  consumeGoogleAuthRateLimit,
  safeReturnPath,
  verifySameOriginRequest,
} from '@/lib/auth';
import {
  appendClearedGoogleNonceCookies,
  authenticateWithGoogle,
  consumeGoogleNonceFromRequest,
} from '@/lib/google-auth';

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

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return jsonResponse({ error: 'A solicitação ficou grande demais.', code: 'PAYLOAD_TOO_LARGE' }, 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 32_768) {
    return jsonResponse({ error: 'A solicitação ficou grande demais.', code: 'PAYLOAD_TOO_LARGE' }, 413);
  }
  const body = (() => {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as { credential?: unknown; returnTo?: unknown }
        : {};
    } catch {
      return {};
    }
  })();
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

  const result = await authenticateWithGoogle(body.credential, expectedNonce);
  if (result.kind === 'error') {
    return jsonResponse({ error: result.error, code: result.code }, result.status);
  }
  await clearGoogleAuthRateLimit(rateLimit.subjectHash);
  if (result.kind === 'pending') {
    return jsonResponse(
      {
        pending: true,
        created: result.created,
        email: result.email,
        message: result.created
          ? 'Cadastro enviado. Um administrador precisa aprovar seu acesso.'
          : 'Seu cadastro ainda aguarda aprovação de um administrador.',
      },
      202,
    );
  }

  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  appendClearedGoogleNonceCookies(headers);
  appendSessionCookies(headers, request, result.session.sessionToken, result.session.csrfToken);
  const destination = safeReturnPath(typeof body.returnTo === 'string' ? body.returnTo : undefined);
  return new Response(JSON.stringify({ user: result.user, destination }), { status: 200, headers });
}
