import { env } from 'cloudflare:workers';

import { getBlockingReasons, type ReturnDetail } from '@/lib/returns';

const statements = [
  `CREATE TABLE IF NOT EXISTS return_sequences (id INTEGER PRIMARY KEY AUTOINCREMENT)`,
  `CREATE TABLE IF NOT EXISTS status_definitions (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    is_system INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS config_options (
    code TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#64748b',
    is_system INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    active INTEGER NOT NULL DEFAULT 1,
    requires_invoice INTEGER NOT NULL DEFAULT 1,
    requires_notes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    google_sub TEXT,
    google_email TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    password_login_enabled INTEGER NOT NULL DEFAULT 1,
    approval_status TEXT NOT NULL DEFAULT 'APPROVED',
    role TEXT NOT NULL DEFAULT 'OPERATOR',
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (role IN ('ADMIN', 'OPERATOR'))
  )`,
  `CREATE TRIGGER IF NOT EXISTS users_keep_one_admin_on_update
    BEFORE UPDATE OF role, active ON users
    WHEN OLD.role = 'ADMIN' AND OLD.active = 1
      AND NOT (NEW.role = 'ADMIN' AND NEW.active = 1)
      AND NOT EXISTS (
        SELECT 1 FROM users
        WHERE id <> OLD.id AND role = 'ADMIN' AND active = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
    END`,
  `CREATE TRIGGER IF NOT EXISTS users_keep_one_admin_on_delete
    BEFORE DELETE ON users
    WHEN OLD.role = 'ADMIN' AND OLD.active = 1
      AND NOT EXISTS (
        SELECT 1 FROM users
        WHERE id <> OLD.id AND role = 'ADMIN' AND active = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
    END`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    subject_hash TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL,
    blocked_until TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_google_nonces (
    nonce_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_bootstrap (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    completed_at TEXT NOT NULL,
    admin_user_id TEXT NOT NULL REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY,
    protocol TEXT NOT NULL UNIQUE,
    store TEXT,
    received_location TEXT NOT NULL,
    received_at TEXT NOT NULL,
    order_id TEXT,
    tracking_code TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING_INFO',
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'MANUAL',
    invoice_number TEXT,
    invoice_date TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finalized_by TEXT,
    finalized_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    sku TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    condition TEXT,
    condition_notes TEXT,
    destination TEXT,
    test_result TEXT,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS return_photos (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS return_videos (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    duration_ms INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    return_id TEXT REFERENCES returns(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_protocol ON returns(protocol)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_status_received ON returns(status, received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_status_finalized ON returns(status, finalized_at)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_tracking ON returns(tracking_code)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items(return_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_photos_return_id ON return_photos(return_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_videos_return_id ON return_videos(return_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_return_videos_object_key ON return_videos(object_key)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_return_id_created ON audit_events(return_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_config_options_type_label ON config_options(type, label)`,
  `CREATE INDEX IF NOT EXISTS idx_config_options_type_active ON config_options(type, active, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)`,
  `CREATE INDEX IF NOT EXISTS idx_users_google_email ON users(google_email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status, active)`,
  `CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(active, role)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)`,
];

const defaultStatuses = [
  ['PENDING_INFO', 'Dados pendentes', 'amber', 10],
  ['IN_TRIAGE', 'Em triagem', 'blue', 20],
  ['WAITING_TEST', 'Aguardando teste', 'sky', 30],
  ['WAITING_DECISION', 'Aguardando decisão', 'orange', 40],
  ['WAITING_ENTRY', 'Aguardando nota', 'violet', 50],
  ['READY', 'Pronta para finalizar', 'emerald', 60],
  ['FINALIZED', 'Finalizada', 'slate', 999],
] as const;

const defaultConfigOptions = [
  ['LOCATION_SAO_PAULO', 'LOCATION', 'Escritório de São Paulo', '#0f766e', 1, 10, 1, 0],
  ['NEW', 'CONDITION', 'Novo', '#16a34a', 1, 10, 1, 0],
  ['SEMI_NEW', 'CONDITION', 'Seminovo', '#0891b2', 1, 20, 1, 0],
  ['DEFECTIVE', 'CONDITION', 'Defeito', '#dc2626', 1, 30, 0, 1],
  ['DAMAGED', 'CONDITION', 'Avariado', '#ea580c', 1, 40, 1, 1],
  ['INCOMPLETE', 'CONDITION', 'Incompleto', '#ca8a04', 1, 50, 1, 1],
  ['OTHER', 'CONDITION', 'Outro', '#64748b', 1, 60, 1, 1],
] as const;

const defaultSystemSettings = [
  ['automatic_cleanup_enabled', '0'],
  ['photo_retention_days', '90'],
  ['return_retention_days', '365'],
  ['last_cleanup_at', ''],
  ['last_cleanup_photos', '0'],
  ['last_cleanup_videos', '0'],
  ['last_cleanup_returns', '0'],
] as const;

let schemaPromise: Promise<void> | null = null;

export function getBindings() {
  if (!env.DB) throw new Error('Banco de dados indisponível.');
  if (!env.FILES) throw new Error('Armazenamento de fotos indisponível.');
  return { db: env.DB, files: env.FILES };
}

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const { db } = getBindings();
      await db.batch(statements.map((statement) => db.prepare(statement)));
      await db.batch(
        defaultStatuses.map(([code, label, color, order]) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO status_definitions
               (code, label, color, is_system, sort_order, active)
               VALUES (?, ?, ?, 1, ?, 1)`,
            )
            .bind(code, label, color, order),
        ),
      );
      await db.batch(
        defaultConfigOptions.map(([code, type, label, color, isSystem, order, requiresInvoice, requiresNotes]) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO config_options
               (code, type, label, color, is_system, sort_order, active, requires_invoice, requires_notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
            )
            .bind(code, type, label, color, isSystem, order, requiresInvoice, requiresNotes, new Date().toISOString()),
        ),
      );
      await db.batch(
        defaultSystemSettings.map(([key, value]) =>
          db
            .prepare('INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)')
            .bind(key, value, new Date().toISOString()),
        ),
      );
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function getReturnDetail(id: string): Promise<ReturnDetail | null> {
  await ensureSchema();
  const { db } = getBindings();
  const record = await db
    .prepare(
      `SELECT r.*, s.label AS status_label, s.color AS status_color,
        COALESCE(store_option.color, '#64748b') AS store_color,
        (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
        (SELECT COUNT(*) FROM return_photos p WHERE p.return_id = r.id) AS photo_count,
        (SELECT COUNT(*) FROM return_videos v WHERE v.return_id = r.id) AS video_count,
        (SELECT p.id FROM return_photos p WHERE p.return_id = r.id ORDER BY p.created_at LIMIT 1) AS first_photo_id
       FROM returns r
       LEFT JOIN status_definitions s ON s.code = r.status
       LEFT JOIN config_options store_option ON store_option.type = 'STORE' AND store_option.label = r.store
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>();

  if (!record) return null;

  const [itemsResult, photosResult, videosResult, historyResult, invoiceExemptConditionsResult] = await Promise.all([
    db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY rowid').bind(id).all(),
    db
      .prepare('SELECT id, file_name, content_type, size, created_at FROM return_photos WHERE return_id = ? ORDER BY created_at')
      .bind(id)
      .all(),
    db
      .prepare('SELECT id, file_name, content_type, size, duration_ms, created_at FROM return_videos WHERE return_id = ? ORDER BY created_at')
      .bind(id)
      .all(),
    db
      .prepare('SELECT id, actor, action, details, created_at FROM audit_events WHERE return_id = ? ORDER BY created_at DESC LIMIT 100')
      .bind(id)
      .all(),
    db
      .prepare("SELECT code, requires_invoice, requires_notes FROM config_options WHERE type = 'CONDITION'")
      .all<{ code: string; requires_invoice: number; requires_notes: number }>(),
  ]);

  const detail = {
    ...record,
    status_label: record.status_label || 'Status não configurado',
    status_color: record.status_color || 'slate',
    items: itemsResult.results,
    photos: photosResult.results,
    videos: videosResult.results,
    history: historyResult.results,
  } as unknown as ReturnDetail;

  detail.blockingReasons = getBlockingReasons(
    detail,
    invoiceExemptConditionsResult.results.filter((condition) => condition.requires_invoice === 0).map((condition) => condition.code),
    invoiceExemptConditionsResult.results.filter((condition) => condition.requires_notes === 1).map((condition) => condition.code),
  );
  const validConditionCodes = new Set(invoiceExemptConditionsResult.results.map((condition) => condition.code));
  for (const product of detail.items) {
    if (product.condition && !validConditionCodes.has(product.condition)) {
      detail.blockingReasons.push(`${product.product}: selecione uma condição válida.`);
    }
  }
  detail.blockingReasons = [...new Set(detail.blockingReasons)];
  detail.canFinalize = detail.blockingReasons.length === 0 && detail.status !== 'FINALIZED';
  return detail;
}

export function apiError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}
