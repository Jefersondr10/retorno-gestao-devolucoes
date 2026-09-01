'use client';

function readCookie(name: string) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return '';
}

function csrfToken() {
  return readCookie('__Host-retorno_csrf') || readCookie('retorno_csrf');
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = csrfToken();
    if (token) headers.set('X-CSRF-Token', token);
  }
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401 && window.location.pathname !== '/login') {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  } else if (response.status === 403 && window.location.pathname !== '/alterar-senha') {
    const clone = response.clone();
    const result = (await clone.json().catch(() => null)) as { code?: string } | null;
    if (result?.code === 'PASSWORD_CHANGE_REQUIRED') window.location.assign('/alterar-senha');
  }
  return response;
}

