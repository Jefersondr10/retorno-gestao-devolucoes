import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';

import {
  actorLabel,
  authUserFromRecord,
  createSession,
  ensureBootstrapAdmin,
  hashPassword,
  type AuthUser,
  type UserRecord,
} from '@/lib/auth';
import { ensureSchema, getBindings } from '@/lib/data';

type GoogleAuthEnvironment = {
  GOOGLE_CLIENT_ID?: string;
};

type GoogleIdentity = {
  sub: string;
  email: string;
  displayName: string;
};

export type GoogleAuthenticationResult =
  | { kind: 'authenticated'; user: AuthUser; session: Awaited<ReturnType<typeof createSession>> }
  | { kind: 'pending'; created: boolean; email: string }
  | { kind: 'error'; error: string; code: string; status: number };

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_NONCE_MAX_AGE_SECONDS = 5 * 60;
const encoder = new TextEncoder();

function environment() {
  return env as unknown as GoogleAuthEnvironment;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength: number) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function parseCookies(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  for (const part of (cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === 'https:';
}

function serializeNonceCookie(name: string, value: string, secure: boolean, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure ? '; Secure' : ''}; HttpOnly`;
}

function nonceCookieName(request: Request) {
  return isSecureRequest(request) ? '__Host-retorno_google_nonce' : 'retorno_google_nonce';
}

export function getGoogleClientId() {
  const clientId = environment().GOOGLE_CLIENT_ID?.trim() || '';
  return /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId) ? clientId : '';
}

export async function issueGoogleNonce(headers: Headers, request: Request) {
  const nonce = randomHex(32);
  const { db } = getBindings();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GOOGLE_NONCE_MAX_AGE_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM auth_google_nonces WHERE expires_at <= ?').bind(now.toISOString()),
    db.prepare('INSERT INTO auth_google_nonces (nonce_hash, expires_at, created_at) VALUES (?, ?, ?)')
      .bind(await sha256(nonce), expiresAt, now.toISOString()),
  ]);
  headers.append(
    'Set-Cookie',
    serializeNonceCookie(nonceCookieName(request), nonce, isSecureRequest(request), GOOGLE_NONCE_MAX_AGE_SECONDS),
  );
  return nonce;
}

export async function consumeGoogleNonceFromRequest(request: Request) {
  const cookies = parseCookies(request.headers.get('cookie'));
  const nonce = cookies.get('__Host-retorno_google_nonce') || cookies.get('retorno_google_nonce') || '';
  if (!/^[0-9a-f]{64}$/.test(nonce)) return '';
  const { db } = getBindings();
  const consumed = await db
    .prepare('DELETE FROM auth_google_nonces WHERE nonce_hash = ? AND expires_at > ? RETURNING nonce_hash')
    .bind(await sha256(nonce), new Date().toISOString())
    .first<{ nonce_hash: string }>();
  return consumed ? nonce : '';
}

export function appendClearedGoogleNonceCookies(headers: Headers) {
  headers.append('Set-Cookie', serializeNonceCookie('__Host-retorno_google_nonce', '', true, 0));
  headers.append('Set-Cookie', serializeNonceCookie('retorno_google_nonce', '', false, 0));
}

async function verifyGoogleCredential(credential: string, expectedNonce: string): Promise<GoogleIdentity> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('GOOGLE_AUTH_NOT_CONFIGURED');

  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    algorithms: ['RS256'],
    audience: clientId,
    issuer: GOOGLE_ISSUERS,
    clockTolerance: 5,
    requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified', 'nonce'],
  });

  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('GOOGLE_TOKEN_EXPIRED');
  }
  if (typeof payload.nonce !== 'string' || !constantTimeEqual(payload.nonce, expectedNonce)) {
    throw new Error('GOOGLE_NONCE_INVALID');
  }
  if (
    (payload.azp !== undefined && payload.azp !== clientId)
    || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
  ) {
    throw new Error('GOOGLE_AZP_INVALID');
  }
  if (typeof payload.sub !== 'string' || !/^[a-z0-9_-]{1,255}$/i.test(payload.sub)) {
    throw new Error('GOOGLE_SUB_INVALID');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string') {
    throw new Error('GOOGLE_EMAIL_UNVERIFIED');
  }

  const email = payload.email.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('GOOGLE_EMAIL_INVALID');
  }
  const claimedName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const displayName = (claimedName || email.split('@')[0] || 'Usuário Google')
    .split('')
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 100)
    .trim() || 'Usuário Google';

  return { sub: payload.sub, email, displayName };
}

async function availableUsername(identity: GoogleIdentity) {
  const { db } = getBindings();
  const digest = await sha256(identity.sub);
  const localPart = identity.email.split('@')[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '') || 'google';
  const bases = [
    `${localPart.slice(0, 54)}-${digest.slice(0, 8)}`,
    `google-${digest.slice(0, 16)}`,
    `google-${digest.slice(0, 24)}`,
  ];
  for (const username of bases) {
    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (!existing) return username;
  }
  return `google-${digest.slice(0, 32)}-${randomHex(4)}`;
}

async function accountByGoogleSub(sub: string) {
  const { db } = getBindings();
  return db.prepare('SELECT * FROM users WHERE google_sub = ?').bind(sub).first<UserRecord>();
}

async function emailBelongsToAnotherGoogleAccount(email: string, sub: string) {
  const { db } = getBindings();
  return db
    .prepare('SELECT id FROM users WHERE google_email = ? COLLATE NOCASE AND (google_sub IS NULL OR google_sub <> ?) LIMIT 1')
    .bind(email, sub)
    .first();
}

async function finishGoogleLogin(record: UserRecord, identity: GoogleIdentity): Promise<GoogleAuthenticationResult> {
  if (record.approval_status === 'PENDING') {
    return { kind: 'pending', created: false, email: identity.email };
  }
  if (record.approval_status !== 'APPROVED' || !record.active) {
    return {
      kind: 'error',
      error: 'Este acesso não está autorizado. Fale com o administrador do sistema.',
      code: 'GOOGLE_ACCESS_DENIED',
      status: 403,
    };
  }
  if (await emailBelongsToAnotherGoogleAccount(identity.email, identity.sub)) {
    return {
      kind: 'error',
      error: 'Esta conta Google já está associada a outro cadastro.',
      code: 'GOOGLE_ACCOUNT_CONFLICT',
      status: 409,
    };
  }

  const { db } = getBindings();
  const loggedInAt = new Date().toISOString();
  await db
    .prepare('UPDATE users SET google_email = ?, last_login_at = ?, updated_at = ? WHERE id = ? AND google_sub = ?')
    .bind(identity.email, loggedInAt, loggedInAt, record.id, identity.sub)
    .run();
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(loggedInAt).run();
  const currentRecord = { ...record, google_email: identity.email, last_login_at: loggedInAt };
  const user = authUserFromRecord(currentRecord);
  const session = await createSession(record.id);
  await db
    .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'GOOGLE_LOGIN', ?, ?)")
    .bind(crypto.randomUUID(), actorLabel(user), JSON.stringify({ userId: user.id, provider: 'GOOGLE' }), loggedInAt)
    .run();
  return { kind: 'authenticated', user, session };
}

async function createPendingGoogleAccount(identity: GoogleIdentity): Promise<GoogleAuthenticationResult> {
  if (await emailBelongsToAnotherGoogleAccount(identity.email, identity.sub)) {
    return {
      kind: 'error',
      error: 'Esta conta Google já está associada a outro cadastro.',
      code: 'GOOGLE_ACCOUNT_CONFLICT',
      status: 409,
    };
  }

  const { db } = getBindings();
  const id = crypto.randomUUID();
  const username = await availableUsername(identity);
  const password = await hashPassword(randomHex(32));
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
           (id, username, display_name, google_sub, google_email, password_hash, password_salt,
            password_iterations, password_login_enabled, approval_status, role, active,
            must_change_password, failed_attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', 'OPERATOR', 0, 0, 0, ?, ?)`,
        )
        .bind(
          id,
          username,
          identity.displayName,
          identity.sub,
          identity.email,
          password.hash,
          password.salt,
          password.iterations,
          now,
          now,
        ),
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'GOOGLE_ACCOUNT_REQUESTED', ?, ?)")
        .bind(
          crypto.randomUUID(),
          `${identity.displayName} (${username})`,
          JSON.stringify({ userId: id, provider: 'GOOGLE' }),
          now,
        ),
    ]);
  } catch (error) {
    const concurrentAccount = await accountByGoogleSub(identity.sub);
    if (concurrentAccount) return finishGoogleLogin(concurrentAccount, identity);
    throw error;
  }
  return { kind: 'pending', created: true, email: identity.email };
}

export async function authenticateWithGoogle(
  credential: string,
  expectedNonce: string,
): Promise<GoogleAuthenticationResult> {
  try {
    await ensureSchema();
    if (!(await ensureBootstrapAdmin())) {
      return {
        kind: 'error',
        error: 'O primeiro acesso ainda não foi configurado.',
        code: 'AUTH_NOT_CONFIGURED',
        status: 503,
      };
    }
    const identity = await verifyGoogleCredential(credential, expectedNonce);
    const account = await accountByGoogleSub(identity.sub);
    return account ? finishGoogleLogin(account, identity) : createPendingGoogleAccount(identity);
  } catch (error) {
    if (error instanceof Error && error.message === 'GOOGLE_AUTH_NOT_CONFIGURED') {
      return {
        kind: 'error',
        error: 'O acesso com Google ainda não foi configurado.',
        code: 'GOOGLE_AUTH_NOT_CONFIGURED',
        status: 503,
      };
    }
    if (error instanceof joseErrors.JOSEError || (error instanceof Error && error.message.startsWith('GOOGLE_'))) {
      return {
        kind: 'error',
        error: 'Não foi possível validar esta conta Google. Tente novamente.',
        code: 'GOOGLE_CREDENTIAL_INVALID',
        status: 401,
      };
    }
    console.error('Google authentication failed', error instanceof Error ? error.name : 'UnknownError');
    return {
      kind: 'error',
      error: 'O login Google está temporariamente indisponível. Tente novamente em instantes.',
      code: 'GOOGLE_AUTH_UNAVAILABLE',
      status: 503,
    };
  }
}
