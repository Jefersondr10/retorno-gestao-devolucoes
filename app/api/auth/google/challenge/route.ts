import { consumeGoogleAuthRateLimit, verifySameOriginRequest } from '@/lib/auth';
import { getGoogleClientId, issueGoogleNonce } from '@/lib/google-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!verifySameOriginRequest(request)) {
    return Response.json(
      { error: 'A solicitação não pôde ser validada.', code: 'ORIGIN_INVALID' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const clientId = getGoogleClientId();
  if (!clientId) {
    return Response.json(
      { error: 'O acesso com Google ainda não foi configurado.', code: 'GOOGLE_AUTH_NOT_CONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const rateLimit = await consumeGoogleAuthRateLimit(request, 'challenge');
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  const nonce = await issueGoogleNonce(headers, request);
  return new Response(JSON.stringify({ nonce, clientId }), { status: 200, headers });
}
