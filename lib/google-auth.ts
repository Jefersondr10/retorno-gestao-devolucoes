import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';

import {
  actorLabel,
  authUserFromRecord,
  createSession,
  hashPassword,
  isReservedBootstrapUsername,
  validateOrganizationName,
  type AuthUser,
  type UserRecord,
} from '@/lib/auth';
import { ensureSchema, getBindings, organizationSeedOperations } from '@/lib/data';

type GoogleAuthEnvironment = {
  GOOGLE_CLIENT_ID?: string;
};

type GoogleIdentity = {
  sub: string;
  email: string;
  displayName: string;
};

type GoogleOnboardingRecord = {
  google_sub: string;
  email: string;
  display_name: string;
  expires_at: string;
};

export type GoogleAuthenticationResult =
  | { kind: 'authenticated'; user: AuthUser; session: Awaited<ReturnType<typeof createSession>> }
  | { kind: 'onboarding'; onboardingToken: string; email: string; displayName: string }
  | { kind: 'error'; error: string; code: string; status: number };

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_NONCE_MAX_AGE_SECONDS = 5 * 60;
const GOOGLE_ONBOARDING_MAX_AGE_SECONDS = 10 * 60;
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

function serializeTokenCookie(name: string, value: string, secure: boolean, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure ? '; Secure' : ''}; HttpOnly`;
}

function nonceCookieName(request: Request) {
  return isSecureRequest(request) ? '__Host-retorno_google_nonce' : 'retorno_google_nonce';
}

function onboardingCookieName(request: Request) {
  return isSecureRequest(request) ? '__Host-retorno_google_onboarding' : 'retorno_google_onboarding';
}

function onboardingTokenFromRequest(request: Request) {
  const cookies = parseCookies(request.headers.get('cookie'));
  return cookies.get('__Host-retorno_google_onboarding') || cookies.get('retorno_google_onboarding') || '';
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
    serializeTokenCookie(nonceCookieName(request), nonce, isSecureRequest(request), GOOGLE_NONCE_MAX_AGE_SECONDS),
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
  headers.append('Set-Cookie', serializeTokenCookie('__Host-retorno_google_nonce', '', true, 0));
  headers.append('Set-Cookie', serializeTokenCookie('retorno_google_nonce', '', false, 0));
}

export function appendGoogleOnboardingCookie(headers: Headers, request: Request, token: string) {
  headers.append(
    'Set-Cookie',
    serializeTokenCookie(onboardingCookieName(request), token, isSecureRequest(request), GOOGLE_ONBOARDING_MAX_AGE_SECONDS),
  );
}

export function appendClearedGoogleOnboardingCookies(headers: Headers) {
  headers.append('Set-Cookie', serializeTokenCookie('__Host-retorno_google_onboarding', '', true, 0));
  headers.append('Set-Cookie', serializeTokenCookie('retorno_google_onboarding', '', false, 0));
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

  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('GOOGLE_TOKEN_EXPIRED');
  if (typeof payload.nonce !== 'string' || !constantTimeEqual(payload.nonce, expectedNonce)) throw new Error('GOOGLE_NONCE_INVALID');
  if (
    (payload.azp !== undefined && payload.azp !== clientId)
    || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
  ) throw new Error('GOOGLE_AZP_INVALID');
  if (typeof payload.sub !== 'string' || !/^[a-z0-9_-]{1,255}$/i.test(payload.sub)) throw new Error('GOOGLE_SUB_INVALID');
  if (payload.email_verified !== true || typeof payload.email !== 'string') throw new Error('GOOGLE_EMAIL_UNVERIFIED');

  const email = payload.email.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('GOOGLE_EMAIL_INVALID');
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
  for (const username of [`${localPart.slice(0, 54)}-${digest.slice(0, 8)}`, `google-${digest.slice(0, 16)}`, `google-${digest.slice(0, 24)}`]) {
    if (!isReservedBootstrapUsername(username) && !(await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first())) return username;
  }
  return `google-${digest.slice(0, 32)}-${randomHex(4)}`;
}

async function activeAccountByGoogleSub(sub: string) {
  const { db } = getBindings();
  return db
    .prepare(`SELECT u.id, m.organization_id, o.name AS organization_name,
      u.username, u.display_name, u.email, u.google_sub, u.google_email,
      u.password_hash, u.password_salt, u.password_iterations, u.password_login_enabled,
      'APPROVED' AS approval_status, m.role, u.active, u.must_change_password,
      u.failed_attempts, u.locked_until, u.last_login_at
      FROM users u
      INNER JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'ACTIVE'
      INNER JOIN organizations o ON o.id = m.organization_id
      WHERE u.google_sub = ? AND u.active = 1
      ORDER BY m.updated_at DESC LIMIT 1`)
    .bind(sub)
    .first<UserRecord>();
}

async function identityByGoogleSub(sub: string) {
  const { db } = getBindings();
  return db.prepare('SELECT * FROM users WHERE google_sub = ? LIMIT 1').bind(sub).first<UserRecord>();
}

async function emailBelongsToAnotherIdentity(email: string, sub: string) {
  const { db } = getBindings();
  return db
    .prepare(`SELECT id FROM users
      WHERE (email = ? COLLATE NOCASE OR google_email = ? COLLATE NOCASE)
        AND (google_sub IS NULL OR google_sub <> ?) LIMIT 1`)
    .bind(email, email, sub)
    .first();
}

async function finishGoogleLogin(record: UserRecord, identity: GoogleIdentity): Promise<GoogleAuthenticationResult> {
  if (await emailBelongsToAnotherIdentity(identity.email, identity.sub)) {
    return { kind: 'error', error: 'Esta conta Google já está associada a outro cadastro.', code: 'GOOGLE_ACCOUNT_CONFLICT', status: 409 };
  }
  const { db } = getBindings();
  const loggedInAt = new Date().toISOString();
  await db
    .prepare('UPDATE users SET email = ?, google_email = ?, last_login_at = ?, updated_at = ? WHERE id = ? AND google_sub = ?')
    .bind(identity.email, identity.email, loggedInAt, loggedInAt, record.id, identity.sub)
    .run();
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(loggedInAt).run();
  const currentRecord = { ...record, email: identity.email, google_email: identity.email, last_login_at: loggedInAt };
  const user = authUserFromRecord(currentRecord);
  const session = await createSession(record.id, record.organization_id);
  await db
    .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'GOOGLE_LOGIN', ?, ?)")
    .bind(crypto.randomUUID(), user.organizationId, actorLabel(user), JSON.stringify({ userId: user.id, provider: 'GOOGLE' }), loggedInAt)
    .run();
  return { kind: 'authenticated', user, session };
}

async function beginGoogleOnboarding(identity: GoogleIdentity, request: Request): Promise<GoogleAuthenticationResult> {
  if (await emailBelongsToAnotherIdentity(identity.email, identity.sub)) {
    return {
      kind: 'error',
      error: 'Já existe uma conta com este e-mail. Entre com o acesso já cadastrado.',
      code: 'GOOGLE_ACCOUNT_CONFLICT',
      status: 409,
    };
  }
  const { db } = getBindings();
  const currentToken = onboardingTokenFromRequest(request);
  const currentOnboarding = await onboardingRecordFromRequest(request, false);
  if (/^[0-9a-f]{64}$/.test(currentToken) && currentOnboarding?.google_sub === identity.sub) {
    return { kind: 'onboarding', onboardingToken: currentToken, email: identity.email, displayName: identity.displayName };
  }
  const token = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GOOGLE_ONBOARDING_MAX_AGE_SECONDS * 1000).toISOString();
  await db.prepare('DELETE FROM auth_google_onboarding WHERE expires_at <= ?').bind(now.toISOString()).run();
  const inserted = await db
    .prepare(`INSERT INTO auth_google_onboarding (token_hash, google_sub, email, display_name, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_sub) DO NOTHING
      RETURNING token_hash`)
    .bind(await sha256(token), identity.sub, identity.email, identity.displayName, expiresAt, now.toISOString())
    .first<{ token_hash: string }>();
  if (!inserted) {
    return {
      kind: 'error',
      error: 'Já existe uma criação de conta em andamento com este Google. Continue na janela em que ela foi iniciada ou aguarde alguns minutos.',
      code: 'GOOGLE_ONBOARDING_IN_PROGRESS',
      status: 409,
    };
  }
  return { kind: 'onboarding', onboardingToken: token, email: identity.email, displayName: identity.displayName };
}

async function onboardingRecordFromRequest(request: Request, consume: boolean) {
  const token = onboardingTokenFromRequest(request);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { db } = getBindings();
  const query = consume
    ? 'DELETE FROM auth_google_onboarding WHERE token_hash = ? AND expires_at > ? RETURNING google_sub, email, display_name, expires_at'
    : 'SELECT google_sub, email, display_name, expires_at FROM auth_google_onboarding WHERE token_hash = ? AND expires_at > ?';
  return db.prepare(query).bind(await sha256(token), new Date().toISOString()).first<GoogleOnboardingRecord>();
}

export async function getGoogleOnboarding(request: Request) {
  await ensureSchema();
  const record = await onboardingRecordFromRequest(request, false);
  return record ? { email: record.email, displayName: record.display_name, expiresAt: record.expires_at } : null;
}

export async function completeGoogleOnboarding(request: Request, organizationNameInput: string): Promise<GoogleAuthenticationResult> {
  await ensureSchema();
  const organizationName = organizationNameInput.trim();
  const validationError = validateOrganizationName(organizationName);
  if (validationError) return { kind: 'error', error: validationError, code: 'ORGANIZATION_INVALID', status: 422 };
  const onboarding = await onboardingRecordFromRequest(request, true);
  if (!onboarding) {
    return { kind: 'error', error: 'Esta criação de conta expirou. Continue com o Google novamente.', code: 'GOOGLE_ONBOARDING_EXPIRED', status: 400 };
  }

  const identity: GoogleIdentity = {
    sub: onboarding.google_sub,
    email: onboarding.email,
    displayName: onboarding.display_name,
  };
  const activeAccount = await activeAccountByGoogleSub(identity.sub);
  if (activeAccount) return finishGoogleLogin(activeAccount, identity);
  if (await emailBelongsToAnotherIdentity(identity.email, identity.sub)) {
    return { kind: 'error', error: 'Já existe uma conta com este e-mail.', code: 'GOOGLE_ACCOUNT_CONFLICT', status: 409 };
  }

  const { db } = getBindings();
  const existingIdentity = await identityByGoogleSub(identity.sub);
  if (existingIdentity && !existingIdentity.active) {
    return {
      kind: 'error',
      error: 'Esta conta está bloqueada. Entre em contato com o suporte.',
      code: 'GOOGLE_IDENTITY_BLOCKED',
      status: 403,
    };
  }
  const userId = existingIdentity?.id || crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const username = existingIdentity?.username || await availableUsername(identity);
  const now = new Date().toISOString();
  const operations: D1PreparedStatement[] = [
    db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(organizationId, organizationName, now, now),
    ...organizationSeedOperations(db, organizationId, now),
  ];
  if (existingIdentity) {
    operations.push(
      db.prepare(`UPDATE users SET display_name = ?, email = ?, google_email = ?, approval_status = 'APPROVED',
        active = CASE WHEN approval_status = 'PENDING' THEN 1 ELSE active END,
        must_change_password = 0, last_login_at = ?, updated_at = ? WHERE id = ? AND google_sub = ?`)
        .bind(identity.displayName, identity.email, identity.email, now, now, userId, identity.sub),
    );
  } else {
    const password = await hashPassword(randomHex(32));
    operations.push(
      db.prepare(`INSERT INTO users
        (id, username, display_name, email, google_sub, google_email, password_hash, password_salt,
         password_iterations, password_login_enabled, approval_status, role, active,
         must_change_password, failed_attempts, last_login_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'APPROVED', 'ADMIN', 1, 0, 0, ?, ?, ?)`)
        .bind(userId, username, identity.displayName, identity.email, identity.sub, identity.email,
          password.hash, password.salt, password.iterations, now, now, now),
    );
  }
  operations.push(
    db.prepare(`INSERT INTO organization_memberships
      (organization_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, 'ADMIN', 'ACTIVE', ?, ?)`).bind(organizationId, userId, now, now),
    db.prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'ORGANIZATION_REGISTERED', ?, ?)")
      .bind(crypto.randomUUID(), organizationId, `${identity.displayName} (${username})`, JSON.stringify({ userId, organizationId, organizationName, provider: 'GOOGLE' }), now),
  );

  try {
    await db.batch(operations);
  } catch (error) {
    const concurrent = await activeAccountByGoogleSub(identity.sub);
    if (concurrent) return finishGoogleLogin(concurrent, identity);
    throw error;
  }

  const user: AuthUser = {
    id: userId,
    organizationId,
    organizationName,
    username,
    displayName: identity.displayName,
    email: identity.email,
    role: 'ADMIN',
    active: true,
    approvalStatus: 'APPROVED',
    passwordLoginEnabled: false,
    googleEmail: identity.email,
    mustChangePassword: false,
    lastLoginAt: now,
  };
  return { kind: 'authenticated', user, session: await createSession(userId, organizationId) };
}

export async function authenticateWithGoogle(credential: string, expectedNonce: string, request: Request): Promise<GoogleAuthenticationResult> {
  try {
    await ensureSchema();
    const identity = await verifyGoogleCredential(credential, expectedNonce);
    const account = await activeAccountByGoogleSub(identity.sub);
    return account ? finishGoogleLogin(account, identity) : beginGoogleOnboarding(identity, request);
  } catch (error) {
    if (error instanceof Error && error.message === 'GOOGLE_AUTH_NOT_CONFIGURED') {
      return { kind: 'error', error: 'O acesso com Google ainda não foi configurado.', code: 'GOOGLE_AUTH_NOT_CONFIGURED', status: 503 };
    }
    if (error instanceof joseErrors.JOSEError || (error instanceof Error && error.message.startsWith('GOOGLE_'))) {
      return { kind: 'error', error: 'Não foi possível validar esta conta Google. Tente novamente.', code: 'GOOGLE_CREDENTIAL_INVALID', status: 401 };
    }
    console.error('Google authentication failed', error instanceof Error ? error.name : 'UnknownError');
    return { kind: 'error', error: 'O login Google está temporariamente indisponível. Tente novamente em instantes.', code: 'GOOGLE_AUTH_UNAVAILABLE', status: 503 };
  }
}
