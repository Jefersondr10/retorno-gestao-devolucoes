import { env } from 'cloudflare:workers';

import { ensureSchema, getBindings, LEGACY_ORGANIZATION_ID, organizationSeedOperations } from '@/lib/data';

export type UserRole = 'ADMIN' | 'OPERATOR';
export type UserApprovalStatus = 'APPROVED' | 'PENDING' | 'REJECTED';

export type AuthUser = {
  id: string;
  organizationId: string;
  organizationName: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  approvalStatus: UserApprovalStatus;
  passwordLoginEnabled: boolean;
  googleEmail: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

type SessionContext = {
  user: AuthUser;
  tokenHash: string;
  csrfHash: string;
  expiresAt: string;
};

export type UserRecord = {
  id: string;
  organization_id: string;
  organization_name?: string;
  username: string;
  display_name: string;
  email: string | null;
  google_sub: string | null;
  google_email: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_login_enabled: number;
  approval_status: UserApprovalStatus;
  role: UserRole;
  active: number;
  must_change_password: number;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
};

type AuthEnvironment = {
  AUTH_BOOTSTRAP_USERNAME?: string;
  AUTH_BOOTSTRAP_DISPLAY_NAME?: string;
  AUTH_BOOTSTRAP_PASSWORD?: string;
  AUTH_PASSWORD_PEPPER?: string;
  APP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
};

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_PASSES = 6;
const PASSWORD_HASH_PREFIX = 'pbkdf2-sha256-6x-v1$';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ACCOUNT_MAX_ATTEMPTS = 8;
const LOGIN_IP_MAX_ATTEMPTS = 30;
const GOOGLE_CHALLENGE_IP_MAX_ATTEMPTS = 120;
const GOOGLE_LOGIN_IP_MAX_ATTEMPTS = 40;
const SIGNUP_IP_MAX_ACCOUNTS = 5;
const LOGIN_RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000;
const FAKE_SALT = `${PASSWORD_HASH_PREFIX}2eb3e19f632664d6b3ac96ad2ff32e2f`;

function authEnvironment() {
  return env as unknown as AuthEnvironment;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error('Formato hexadecimal inválido.');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function randomHex(byteLength: number) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function isCurrentPasswordHash(salt: string) {
  return salt.startsWith(PASSWORD_HASH_PREFIX);
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function passwordMaterial(password: string) {
  const pepper = authEnvironment().AUTH_PASSWORD_PEPPER;
  if (!pepper) return encoder.encode(password);
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(password)));
}

async function derivePbkdf2Block(material: Uint8Array, salt: Uint8Array, iterations: number) {
  const keyMaterial = new Uint8Array(material.byteLength);
  keyMaterial.set(material);
  const blockSalt = new Uint8Array(salt.byteLength);
  blockSalt.set(salt);
  const key = await crypto.subtle.importKey('raw', keyMaterial.buffer, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: blockSalt.buffer, iterations },
      key,
      256,
    ),
  );
}

async function derivePasswordHash(password: string, salt: string, iterations: number) {
  const material = await passwordMaterial(password);
  const isCurrentFormat = isCurrentPasswordHash(salt);
  const saltBytes = hexToBytes(isCurrentFormat ? salt.slice(PASSWORD_HASH_PREFIX.length) : salt);

  // Hashes anteriores não tinham identificador de formato e permanecem
  // verificáveis nos ambientes que aceitam sua contagem original de iterações.
  if (!isCurrentFormat) {
    return bytesToHex(await derivePbkdf2Block(material, saltBytes, iterations));
  }

  if (iterations < 1 || iterations > PASSWORD_ITERATIONS) throw new Error('Parâmetros de senha inválidos.');

  const blocks: Uint8Array[] = [];
  for (let pass = 0; pass < PASSWORD_PASSES; pass += 1) {
    const passSalt = new Uint8Array(saltBytes.length + 1);
    passSalt.set(saltBytes);
    passSalt[saltBytes.length] = pass;
    blocks.push(await derivePbkdf2Block(material, passSalt, iterations));
  }

  const combined = new Uint8Array(blocks.length * 32);
  blocks.forEach((block, index) => combined.set(block, index * 32));
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', combined)));
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function normalizeUsername(username: string) {
  return username.trim().toLocaleLowerCase('pt-BR');
}

export function isReservedBootstrapUsername(username: string) {
  const configured = normalizeUsername(authEnvironment().AUTH_BOOTSTRAP_USERNAME || '');
  return Boolean(configured && configured === normalizeUsername(username));
}

export function validateUsername(username: string) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) {
    return 'Use de 3 a 64 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.';
  }
  return '';
}

export function validatePassword(password: string) {
  if (password.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (password.length > 128 || encoder.encode(password).byteLength > 512) return 'A senha ficou longa demais.';
  return '';
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (normalized.length < 5 || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Informe um e-mail válido.';
  }
  return '';
}

export function validateDisplayName(name: string) {
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 100) return 'Informe seu nome com 2 a 100 caracteres.';
  return '';
}

export function validateOrganizationName(name: string) {
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120) return 'Informe o nome da empresa com 2 a 120 caracteres.';
  return '';
}

export async function hashPassword(password: string) {
  const salt = `${PASSWORD_HASH_PREFIX}${randomHex(16)}`;
  return {
    hash: await derivePasswordHash(password, salt, PASSWORD_ITERATIONS),
    salt,
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(password: string, record: Pick<UserRecord, 'password_hash' | 'password_salt' | 'password_iterations'>) {
  try {
    const candidate = await derivePasswordHash(password, record.password_salt, record.password_iterations);
    return constantTimeEqual(candidate, record.password_hash);
  } catch (error) {
    if (!isCurrentPasswordHash(record.password_salt) && error instanceof Error && error.name === 'NotSupportedError') {
      return false;
    }
    throw error;
  }
}

export function authUserFromRecord(record: Pick<UserRecord, 'id' | 'organization_id' | 'organization_name' | 'username' | 'display_name' | 'email' | 'role' | 'active' | 'approval_status' | 'password_login_enabled' | 'google_email' | 'must_change_password' | 'last_login_at'>): AuthUser {
  return {
    id: record.id,
    organizationId: record.organization_id,
    organizationName: record.organization_name || 'Minha empresa',
    username: record.username,
    displayName: record.display_name,
    email: record.email,
    role: record.role,
    active: Boolean(record.active),
    approvalStatus: record.approval_status,
    passwordLoginEnabled: Boolean(record.password_login_enabled),
    googleEmail: record.google_email,
    mustChangePassword: Boolean(record.must_change_password),
    lastLoginAt: record.last_login_at,
  };
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

function sessionTokenFromCookieHeader(cookieHeader: string | null) {
  const cookies = parseCookies(cookieHeader);
  return cookies.get('__Host-retorno_session') || cookies.get('retorno_session') || '';
}

function csrfTokenFromCookieHeader(cookieHeader: string | null) {
  const cookies = parseCookies(cookieHeader);
  return cookies.get('__Host-retorno_csrf') || cookies.get('retorno_csrf') || '';
}

export async function getSessionContextFromCookie(cookieHeader: string | null): Promise<SessionContext | null> {
  await ensureSchema();
  const token = sessionTokenFromCookieHeader(cookieHeader);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const { db } = getBindings();
  const now = new Date().toISOString();
  const record = await db
    .prepare(
      `SELECT s.token_hash, s.csrf_hash, s.expires_at,
        u.id, s.organization_id, o.name AS organization_name,
        u.username, u.display_name, u.email, m.role, u.active,
        'APPROVED' AS approval_status, u.password_login_enabled, u.google_email,
        u.must_change_password, u.last_login_at
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       INNER JOIN organizations o ON o.id = s.organization_id
       INNER JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = s.organization_id
       WHERE s.token_hash = ? AND s.expires_at > ?
         AND u.active = 1 AND m.status = 'ACTIVE'`,
    )
    .bind(tokenHash, now)
    .first<Record<string, unknown>>();
  if (!record) return null;
  return {
    tokenHash,
    csrfHash: String(record.csrf_hash),
    expiresAt: String(record.expires_at),
    user: authUserFromRecord({
      id: String(record.id),
      organization_id: String(record.organization_id),
      organization_name: String(record.organization_name),
      username: String(record.username),
      display_name: String(record.display_name),
      email: typeof record.email === 'string' ? record.email : null,
      role: record.role as UserRole,
      active: Number(record.active),
      approval_status: record.approval_status as UserApprovalStatus,
      password_login_enabled: Number(record.password_login_enabled),
      google_email: typeof record.google_email === 'string' ? record.google_email : null,
      must_change_password: Number(record.must_change_password),
      last_login_at: typeof record.last_login_at === 'string' ? record.last_login_at : null,
    }),
  };
}

export async function getSessionUserFromCookie(cookieHeader: string | null) {
  return (await getSessionContextFromCookie(cookieHeader))?.user || null;
}

function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === 'https:';
}

function cookieNames(request: Request) {
  const secure = isSecureRequest(request);
  return {
    session: secure ? '__Host-retorno_session' : 'retorno_session',
    csrf: secure ? '__Host-retorno_csrf' : 'retorno_csrf',
    secure,
  };
}

function serializeCookie(name: string, value: string, options: { secure: boolean; httpOnly: boolean; maxAge: number }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${options.maxAge}; SameSite=Strict${options.secure ? '; Secure' : ''}${options.httpOnly ? '; HttpOnly' : ''}`;
}

export function appendSessionCookies(headers: Headers, request: Request, sessionToken: string, csrfToken: string) {
  const names = cookieNames(request);
  headers.append('Set-Cookie', serializeCookie(names.session, sessionToken, { secure: names.secure, httpOnly: true, maxAge: SESSION_MAX_AGE_SECONDS }));
  headers.append('Set-Cookie', serializeCookie(names.csrf, csrfToken, { secure: names.secure, httpOnly: false, maxAge: SESSION_MAX_AGE_SECONDS }));
}

export function appendClearedSessionCookies(headers: Headers, request: Request) {
  const names = new Set([
    cookieNames(request).session,
    cookieNames(request).csrf,
    '__Host-retorno_session',
    '__Host-retorno_csrf',
    'retorno_session',
    'retorno_csrf',
  ]);
  for (const name of names) headers.append('Set-Cookie', serializeCookie(name, '', { secure: name.startsWith('__Host-'), httpOnly: name.includes('session'), maxAge: 0 }));
}

export async function createSession(userId: string, organizationId: string) {
  await ensureSchema();
  const { db } = getBindings();
  const eligibleUser = await db
    .prepare(`SELECT u.id FROM users u
      INNER JOIN organization_memberships m ON m.user_id = u.id
      WHERE u.id = ? AND m.organization_id = ? AND u.active = 1 AND m.status = 'ACTIVE'`)
    .bind(userId, organizationId)
    .first();
  if (!eligibleUser) throw new Error('Usuário sem autorização para iniciar uma sessão.');
  const sessionToken = randomHex(32);
  const csrfToken = randomHex(24);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, organization_id, csrf_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(await sha256(sessionToken), userId, organizationId, await sha256(csrfToken), expiresAt, now.toISOString(), now.toISOString())
    .run();
  return { sessionToken, csrfToken, expiresAt };
}

export function actorLabel(user: AuthUser) {
  return `${user.displayName} (${user.username})`;
}

function jsonError(message: string, status: number, code: string) {
  return Response.json({ error: message, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function expectedOrigin(request: Request) {
  return authEnvironment().APP_ORIGIN?.replace(/\/$/, '') || new URL(request.url).origin;
}

export function verifySameOriginRequest(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const origin = request.headers.get('origin');
  return Boolean(origin && origin.replace(/\/$/, '') === expectedOrigin(request));
}

async function verifyCsrf(request: Request, session: SessionContext) {
  if (!verifySameOriginRequest(request)) return false;
  const headerToken = request.headers.get('x-csrf-token') || '';
  const cookieToken = csrfTokenFromCookieHeader(request.headers.get('cookie'));
  if (!headerToken || !cookieToken || !constantTimeEqual(headerToken, cookieToken)) return false;
  return constantTimeEqual(await sha256(headerToken), session.csrfHash);
}

export async function authenticateApi(
  request: Request,
  options: { roles?: UserRole[]; allowPasswordChange?: boolean; csrf?: boolean } = {},
): Promise<{ user: AuthUser; session: SessionContext } | { response: Response }> {
  const session = await getSessionContextFromCookie(request.headers.get('cookie'));
  if (!session) return { response: jsonError('Sua sessão terminou. Entre novamente.', 401, 'UNAUTHENTICATED') };
  if (session.user.mustChangePassword && !options.allowPasswordChange) {
    return { response: jsonError('Troque sua senha temporária para continuar.', 403, 'PASSWORD_CHANGE_REQUIRED') };
  }
  if (options.roles && !options.roles.includes(session.user.role)) {
    return { response: jsonError('Seu perfil não tem permissão para esta ação.', 403, 'FORBIDDEN') };
  }
  const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  if ((options.csrf ?? unsafeMethod) && !(await verifyCsrf(request, session))) {
    return { response: jsonError('A solicitação não pôde ser validada. Atualize a página e tente novamente.', 403, 'CSRF_INVALID') };
  }
  return { user: session.user, session };
}

type LoginRateLimitResult = {
  allowed: boolean;
  subjectHash: string;
  attempts: number;
  blockedUntil: string | null;
};

function requestAddress(request: Request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

async function consumeLoginRateLimit(
  kind: 'ip' | 'account' | 'password-change' | 'google-challenge' | 'google-login' | 'signup' | `organization-${string}`,
  subject: string,
  maxAttempts: number,
): Promise<LoginRateLimitResult> {
  const { db } = getBindings();
  const subjectHash = await sha256(`${kind}|${subject}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const windowCutoff = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  const newBlockedUntil = new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString();
  const record = await db
    .prepare(
      `INSERT INTO auth_rate_limits (subject_hash, attempts, window_started_at, blocked_until, updated_at)
       VALUES (?1, 1, ?2, NULL, ?2)
       ON CONFLICT(subject_hash) DO UPDATE SET
         attempts = CASE
           WHEN auth_rate_limits.blocked_until > ?2 THEN auth_rate_limits.attempts
           WHEN auth_rate_limits.window_started_at <= ?3 THEN 1
           ELSE auth_rate_limits.attempts + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.blocked_until > ?2 THEN auth_rate_limits.window_started_at
           WHEN auth_rate_limits.window_started_at <= ?3 THEN ?2
           ELSE auth_rate_limits.window_started_at
         END,
         blocked_until = CASE
           WHEN auth_rate_limits.blocked_until > ?2 THEN auth_rate_limits.blocked_until
           WHEN auth_rate_limits.window_started_at <= ?3 THEN NULL
           WHEN auth_rate_limits.attempts + 1 > ?4 THEN ?5
           ELSE NULL
         END,
         updated_at = ?2
       RETURNING attempts, blocked_until`,
    )
    .bind(subjectHash, nowIso, windowCutoff, maxAttempts, newBlockedUntil)
    .first<{ attempts: number; blocked_until: string | null }>();
  const attempts = Number(record?.attempts || 1);
  const blockedUntil = record?.blocked_until || null;
  return {
    allowed: !blockedUntil || Date.parse(blockedUntil) <= now.getTime(),
    subjectHash,
    attempts,
    blockedUntil,
  };
}

async function clearLoginFailures(ipSubjectHash: string, accountSubjectHash: string | null, userId: string) {
  const { db } = getBindings();
  const operations: D1PreparedStatement[] = [
    db.prepare('DELETE FROM auth_rate_limits WHERE subject_hash = ? AND attempts <= 1').bind(ipSubjectHash),
    db
      .prepare('UPDATE auth_rate_limits SET attempts = attempts - 1, updated_at = ? WHERE subject_hash = ? AND attempts > 1')
      .bind(new Date().toISOString(), ipSubjectHash),
  ];
  if (accountSubjectHash) operations.push(db.prepare('DELETE FROM auth_rate_limits WHERE subject_hash = ?').bind(accountSubjectHash));
  operations.push(db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(userId));
  await db.batch(operations);
}

export async function consumePasswordChangeRateLimit(userId: string) {
  await ensureSchema();
  return consumeLoginRateLimit('password-change', userId, LOGIN_ACCOUNT_MAX_ATTEMPTS);
}

export async function consumeGoogleAuthRateLimit(request: Request, phase: 'challenge' | 'login') {
  await ensureSchema();
  const { db } = getBindings();
  await db
    .prepare('DELETE FROM auth_rate_limits WHERE updated_at <= ?')
    .bind(new Date(Date.now() - LOGIN_RATE_LIMIT_TTL_MS).toISOString())
    .run();
  return consumeLoginRateLimit(
    phase === 'challenge' ? 'google-challenge' : 'google-login',
    requestAddress(request),
    phase === 'challenge' ? GOOGLE_CHALLENGE_IP_MAX_ATTEMPTS : GOOGLE_LOGIN_IP_MAX_ATTEMPTS,
  );
}

export async function consumeOrganizationActionRateLimit(organizationId: string, action: string, maximumAttempts: number) {
  await ensureSchema();
  const { db } = getBindings();
  await db
    .prepare('DELETE FROM auth_rate_limits WHERE updated_at <= ?')
    .bind(new Date(Date.now() - LOGIN_RATE_LIMIT_TTL_MS).toISOString())
    .run();
  return consumeLoginRateLimit(`organization-${action}`, organizationId, maximumAttempts);
}

export async function clearGoogleAuthRateLimit(subjectHash: string) {
  const { db } = getBindings();
  await db.prepare('DELETE FROM auth_rate_limits WHERE subject_hash = ?').bind(subjectHash).run();
}

export async function userAuthenticationRateLimitHashes(userId: string) {
  return {
    account: await sha256(`account|${userId}`),
    passwordChange: await sha256(`password-change|${userId}`),
  };
}

export async function ensureBootstrapAdmin() {
  await ensureSchema();
  const { db } = getBindings();
  const completed = await db
    .prepare(
      `SELECT b.id
       FROM auth_bootstrap b
       INNER JOIN users u ON u.id = b.admin_user_id
       INNER JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ?
       WHERE b.id = 1 AND m.role = 'ADMIN' AND m.status = 'ACTIVE' AND u.active = 1`,
    )
    .bind(LEGACY_ORGANIZATION_ID)
    .first();
  if (completed) return true;

  const existingAdmin = await db
    .prepare(`SELECT u.id FROM users u
      INNER JOIN organization_memberships m ON m.user_id = u.id
      WHERE m.organization_id = ? AND m.role = 'ADMIN' AND m.status = 'ACTIVE' AND u.active = 1
      ORDER BY m.created_at LIMIT 1`)
    .bind(LEGACY_ORGANIZATION_ID)
    .first<{ id: string }>();
  if (existingAdmin) {
    await db
      .prepare(
        `INSERT INTO auth_bootstrap (id, completed_at, admin_user_id) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET completed_at = excluded.completed_at, admin_user_id = excluded.admin_user_id`,
      )
      .bind(new Date().toISOString(), existingAdmin.id)
      .run();
    return true;
  }

  const configuration = authEnvironment();
  const username = normalizeUsername(configuration.AUTH_BOOTSTRAP_USERNAME || '');
  const displayName = configuration.AUTH_BOOTSTRAP_DISPLAY_NAME?.trim() || 'Administrador';
  const password = configuration.AUTH_BOOTSTRAP_PASSWORD || '';
  if (validateUsername(username) || validatePassword(password)) return false;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordData = await hashPassword(password);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
           (id, username, display_name, password_hash, password_salt, password_iterations, role, active,
            must_change_password, failed_attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', 1, 1, 0, ?, ?)`,
        )
        .bind(id, username, displayName, passwordData.hash, passwordData.salt, passwordData.iterations, now, now),
      db
        .prepare(`INSERT INTO organization_memberships
          (organization_id, user_id, role, status, created_at, updated_at)
          VALUES (?, ?, 'ADMIN', 'ACTIVE', ?, ?)`)
        .bind(LEGACY_ORGANIZATION_ID, id, now, now),
      db
        .prepare(
          `INSERT INTO auth_bootstrap (id, completed_at, admin_user_id) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET completed_at = excluded.completed_at, admin_user_id = excluded.admin_user_id`,
        )
        .bind(now, id),
      db
        .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'BOOTSTRAP_ADMIN', ?, ?)")
        .bind(crypto.randomUUID(), LEGACY_ORGANIZATION_ID, `${displayName} (${username})`, JSON.stringify({ userId: id, username }), now),
    ]);
  } catch (error) {
    const winner = await db
      .prepare(
        `SELECT b.id
         FROM auth_bootstrap b
         INNER JOIN users u ON u.id = b.admin_user_id
         INNER JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ?
         WHERE b.id = 1 AND m.role = 'ADMIN' AND m.status = 'ACTIVE' AND u.active = 1`,
      )
      .bind(LEGACY_ORGANIZATION_ID)
      .first();
    if (!winner) throw error;
  }
  return true;
}

export async function login(request: Request, usernameInput: string, password: string) {
  await ensureSchema();
  const username = normalizeUsername(usernameInput);
  if (isReservedBootstrapUsername(username) && !(await ensureBootstrapAdmin())) {
    return { error: 'O primeiro acesso administrativo ainda não foi configurado.', status: 503, code: 'AUTH_NOT_CONFIGURED' } as const;
  }
  const { db } = getBindings();
  await db
    .prepare('DELETE FROM auth_rate_limits WHERE updated_at <= ?')
    .bind(new Date(Date.now() - LOGIN_RATE_LIMIT_TTL_MS).toISOString())
    .run();
  const ipRateLimit = await consumeLoginRateLimit('ip', requestAddress(request), LOGIN_IP_MAX_ATTEMPTS);
  if (!ipRateLimit.allowed) {
    return { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.', status: 429, code: 'RATE_LIMITED' } as const;
  }

  const user = await db
    .prepare(`SELECT u.id, m.organization_id, o.name AS organization_name,
      u.username, u.display_name, u.email, u.google_sub, u.google_email,
      u.password_hash, u.password_salt, u.password_iterations, u.password_login_enabled,
      'APPROVED' AS approval_status, m.role, u.active, u.must_change_password,
      u.failed_attempts, u.locked_until, u.last_login_at
      FROM users u
      INNER JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'ACTIVE'
      INNER JOIN organizations o ON o.id = m.organization_id
      WHERE u.username = ? OR u.email = ?
      ORDER BY m.updated_at DESC LIMIT 1`)
    .bind(username, normalizeEmail(usernameInput))
    .first<UserRecord>();
  const accountRateLimit = user
    ? await consumeLoginRateLimit('account', user.id, LOGIN_ACCOUNT_MAX_ATTEMPTS)
    : null;
  if (accountRateLimit && !accountRateLimit.allowed) {
    return { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.', status: 429, code: 'RATE_LIMITED' } as const;
  }
  const passwordMatches = user?.password_login_enabled
    ? await verifyPassword(password, user)
    : constantTimeEqual(await derivePasswordHash(password || 'senha-invalida', FAKE_SALT, PASSWORD_ITERATIONS), '0'.repeat(64));

  if (
    !user
    || !user.active
    || !user.password_login_enabled
    || !passwordMatches
  ) {
    if (user) {
      await db
        .prepare('UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = ?, updated_at = ? WHERE id = ?')
        .bind(accountRateLimit?.blockedUntil || null, new Date().toISOString(), user.id)
        .run();
    }
    return { error: 'Usuário ou senha inválidos.', status: 401, code: 'INVALID_CREDENTIALS' } as const;
  }

  const loggedInAt = new Date().toISOString();
  const passwordUpgrade = isCurrentPasswordHash(user.password_salt) ? null : await hashPassword(password);
  await clearLoginFailures(ipRateLimit.subjectHash, accountRateLimit?.subjectHash || null, user.id);
  if (passwordUpgrade) {
    await db
      .prepare(
        `UPDATE users
         SET password_hash = ?, password_salt = ?, password_iterations = ?, last_login_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(passwordUpgrade.hash, passwordUpgrade.salt, passwordUpgrade.iterations, loggedInAt, loggedInAt, user.id)
      .run();
  } else {
    await db
      .prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .bind(loggedInAt, loggedInAt, user.id)
      .run();
  }
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(loggedInAt).run();
  const session = await createSession(user.id, user.organization_id);
  const authenticatedUser = authUserFromRecord({ ...user, last_login_at: loggedInAt });
  await db
    .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'LOGIN', ?, ?)")
    .bind(crypto.randomUUID(), authenticatedUser.organizationId, actorLabel(authenticatedUser), JSON.stringify({ userId: user.id }), loggedInAt)
    .run();
  return { user: authenticatedUser, session } as const;
}

export async function registerWithPassword(request: Request, input: {
  displayName: string;
  organizationName: string;
  username: string;
  password: string;
}) {
  await ensureSchema();
  const displayName = input.displayName.trim();
  const organizationName = input.organizationName.trim();
  const username = normalizeUsername(input.username);
  const validationError = validateDisplayName(displayName)
    || validateOrganizationName(organizationName)
    || validateUsername(username)
    || validatePassword(input.password);
  if (validationError) return { error: validationError, status: 422, code: 'INVALID_REGISTRATION' } as const;
  if (isReservedBootstrapUsername(username)) {
    return { error: 'Esse nome de usuário não está disponível.', status: 409, code: 'USERNAME_IN_USE' } as const;
  }

  const { db } = getBindings();
  await db
    .prepare('DELETE FROM auth_rate_limits WHERE updated_at <= ?')
    .bind(new Date(Date.now() - LOGIN_RATE_LIMIT_TTL_MS).toISOString())
    .run();
  const ipRateLimit = await consumeLoginRateLimit('signup', requestAddress(request), SIGNUP_IP_MAX_ACCOUNTS);
  if (!ipRateLimit.allowed) {
    return { error: 'Muitas contas foram criadas nesta conexão. Aguarde alguns minutos e tente novamente.', status: 429, code: 'RATE_LIMITED' } as const;
  }

  const duplicate = await db
    .prepare('SELECT id FROM users WHERE username = ? LIMIT 1')
    .bind(username)
    .first();
  if (duplicate) return { error: 'Esse nome de usuário não está disponível.', status: 409, code: 'USERNAME_IN_USE' } as const;

  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const password = await hashPassword(input.password);
  try {
    await db.batch([
      db
        .prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(organizationId, organizationName, now, now),
      ...organizationSeedOperations(db, organizationId, now),
      db
        .prepare(
          `INSERT INTO users
           (id, username, display_name, password_hash, password_salt,
            password_iterations, password_login_enabled, approval_status, role, active,
            must_change_password, failed_attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'APPROVED', 'ADMIN', 1, 0, 0, ?, ?)`,
        )
        .bind(userId, username, displayName, password.hash, password.salt, password.iterations, now, now),
      db
        .prepare(`INSERT INTO organization_memberships
          (organization_id, user_id, role, status, created_at, updated_at)
          VALUES (?, ?, 'ADMIN', 'ACTIVE', ?, ?)`)
        .bind(organizationId, userId, now, now),
      db
        .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'ORGANIZATION_REGISTERED', ?, ?)")
        .bind(
          crypto.randomUUID(),
          organizationId,
          `${displayName} (${username})`,
          JSON.stringify({ userId, organizationId, organizationName, provider: 'PASSWORD' }),
          now,
        ),
    ]);
  } catch (error) {
    const concurrent = await db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').bind(username).first();
    if (concurrent) return { error: 'Esse nome de usuário não está disponível.', status: 409, code: 'USERNAME_IN_USE' } as const;
    throw error;
  }

  const user: AuthUser = {
    id: userId,
    organizationId,
    organizationName,
    username,
    displayName,
    email: null,
    role: 'ADMIN',
    active: true,
    approvalStatus: 'APPROVED',
    passwordLoginEnabled: true,
    googleEmail: null,
    mustChangePassword: false,
    lastLoginAt: now,
  };
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, userId).run();
  return { user, session: await createSession(userId, organizationId) } as const;
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (value.startsWith('/login')) return '/';
  return value;
}
