import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const response = request.nextUrl.hostname === 'retorno-gestao-devolucoes.jefersondr10.chatgpt.site'
    ? NextResponse.redirect(new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, 'https://devolucoes.nucleodeoperacao.com.br'))
    : NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Content-Security-Policy', "base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (request.nextUrl.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|og.png).*)'],
};
