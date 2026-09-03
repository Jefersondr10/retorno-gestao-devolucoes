import { env } from 'cloudflare:workers';

import { getBlockingReasons, type ReturnDetail } from '@/lib/returns';

export const LEGACY_ORGANIZATION_ID = 'org_nucleo_legacy';

const statements = [
  `CREATE TABLE IF NOT EXISTS return_sequences (id INTEGER PRIMARY KEY AUTOINCREMENT)`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tenant_status_definitions (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    is_system INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    active INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (organization_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS tenant_config_options (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#64748b',
    is_system INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    active INTEGER NOT NULL DEFAULT 1,
    requires_invoice INTEGER NOT NULL DEFAULT 1,
    requires_notes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS tenant_system_settings (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT,
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
  `CREATE TABLE IF NOT EXISTS organization_memberships (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'OPERATOR',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, user_id),
    CHECK (role IN ('ADMIN', 'OPERATOR')),
    CHECK (status IN ('ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED'))
  )`,
  `CREATE TABLE IF NOT EXISTS organization_membership_permissions (
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, user_id, permission),
    FOREIGN KEY (organization_id, user_id)
      REFERENCES organization_memberships(organization_id, user_id) ON DELETE CASCADE,
    CHECK (permission IN (
      'returns.view', 'returns.create', 'returns.edit', 'returns.finalize',
      'returns.delete', 'settings.manage', 'retention.manage', 'team.manage'
    ))
  )`,
  `CREATE TABLE IF NOT EXISTS user_release_acknowledgements (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    release_id TEXT NOT NULL,
    acknowledged_at TEXT NOT NULL,
    PRIMARY KEY (user_id, release_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS memberships_keep_one_admin_on_update
    BEFORE UPDATE OF role, status, organization_id ON organization_memberships
    WHEN OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE'
      AND NOT (NEW.role = 'ADMIN' AND NEW.status = 'ACTIVE' AND NEW.organization_id = OLD.organization_id)
      AND NOT EXISTS (
        SELECT 1 FROM organization_memberships
        WHERE user_id <> OLD.user_id AND organization_id = OLD.organization_id AND role = 'ADMIN' AND status = 'ACTIVE'
      )
    BEGIN
      SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
    END`,
  `CREATE TRIGGER IF NOT EXISTS memberships_keep_one_admin_on_delete
    BEFORE DELETE ON organization_memberships
    WHEN OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM organization_memberships
        WHERE user_id <> OLD.user_id AND organization_id = OLD.organization_id AND role = 'ADMIN' AND status = 'ACTIVE'
      )
    BEGIN
      SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
    END`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
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
  `CREATE TABLE IF NOT EXISTS auth_google_onboarding (
    token_hash TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
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
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
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
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    return_id TEXT REFERENCES returns(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_protocol ON returns(protocol)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_org_status_received ON returns(organization_id, status, received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_org_status_finalized ON returns(organization_id, status, finalized_at)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_org_tracking ON returns(organization_id, tracking_code)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_org_order ON returns(organization_id, order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items(return_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_photos_return_id ON return_photos(return_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_videos_return_id ON return_videos(return_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_return_videos_object_key ON return_videos(object_key)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events(organization_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_return_id_created ON audit_events(return_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_status_org_code ON tenant_status_definitions(organization_id, code)`,
  `CREATE INDEX IF NOT EXISTS idx_tenant_status_org_active ON tenant_status_definitions(organization_id, active, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_config_org_code ON tenant_config_options(organization_id, code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_config_org_type_label ON tenant_config_options(organization_id, type, label)`,
  `CREATE INDEX IF NOT EXISTS idx_tenant_config_org_type_active ON tenant_config_options(organization_id, type, active, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_settings_org_key ON tenant_system_settings(organization_id, key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users(email COLLATE NOCASE) WHERE email IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_org_user ON organization_memberships(organization_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_user_status ON organization_memberships(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_org_status_role ON organization_memberships(organization_id, status, role)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_one_active_org ON organization_memberships(user_id) WHERE status = 'ACTIVE'`,
  `CREATE INDEX IF NOT EXISTS idx_users_google_email ON users(google_email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status, active)`,
  `CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(active, role)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_organization ON auth_sessions(organization_id)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_google_onboarding_sub ON auth_google_onboarding(google_sub)`,
  `CREATE TRIGGER IF NOT EXISTS auth_sessions_require_organization_insert
    BEFORE INSERT ON auth_sessions WHEN NEW.organization_id IS NULL
    BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED'); END`,
  `CREATE TRIGGER IF NOT EXISTS auth_sessions_require_organization_update
    BEFORE UPDATE OF organization_id ON auth_sessions WHEN NEW.organization_id IS NULL
    BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED'); END`,
  `CREATE TRIGGER IF NOT EXISTS returns_require_organization_insert
    BEFORE INSERT ON returns WHEN NEW.organization_id IS NULL
    BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED'); END`,
  `CREATE TRIGGER IF NOT EXISTS returns_require_organization_update
    BEFORE UPDATE OF organization_id ON returns WHEN NEW.organization_id IS NULL
    BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_events_require_organization_insert
    BEFORE INSERT ON audit_events WHEN NEW.organization_id IS NULL
    BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_events_require_organization_update
    BEFORE UPDATE OF organization_id ON audit_events WHEN NEW.organization_id IS NULL
    BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED'); END`,
];

export const defaultStatuses = [
  ['PENDING_INFO', 'Dados pendentes', 'amber', 10],
  ['IN_TRIAGE', 'Em triagem', 'blue', 20],
  ['WAITING_TEST', 'Aguardando teste', 'sky', 30],
  ['WAITING_DECISION', 'Aguardando decisão', 'orange', 40],
  ['WAITING_ENTRY', 'Aguardando nota', 'violet', 50],
  ['READY', 'Pronta para finalizar', 'emerald', 60],
  ['FINALIZED', 'Finalizada', 'slate', 999],
] as const;

export const defaultConfigOptions = [
  ['LOCATION_SAO_PAULO', 'LOCATION', 'Escritório de São Paulo', '#0f766e', 1, 10, 1, 0],
  ['NEW', 'CONDITION', 'Novo', '#16a34a', 1, 10, 1, 0],
  ['SEMI_NEW', 'CONDITION', 'Seminovo', '#0891b2', 1, 20, 1, 0],
  ['DEFECTIVE', 'CONDITION', 'Defeito', '#dc2626', 1, 30, 0, 1],
  ['DAMAGED', 'CONDITION', 'Avariado', '#ea580c', 1, 40, 1, 1],
  ['INCOMPLETE', 'CONDITION', 'Incompleto', '#ca8a04', 1, 50, 1, 1],
  ['OTHER', 'CONDITION', 'Outro', '#64748b', 1, 60, 1, 1],
] as const;

export const defaultSystemSettings = [
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

export function organizationSeedOperations(db: D1Database, organizationId: string, now = new Date().toISOString()) {
  return [
    ...defaultStatuses.map(([code, label, color, order]) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO tenant_status_definitions
           (organization_id, code, label, color, is_system, sort_order, active)
           VALUES (?, ?, ?, ?, 1, ?, 1)`,
        )
        .bind(organizationId, code, label, color, order),
    ),
    ...defaultConfigOptions.map(([code, type, label, color, isSystem, order, requiresInvoice, requiresNotes]) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO tenant_config_options
           (organization_id, code, type, label, color, is_system, sort_order, active, requires_invoice, requires_notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(organizationId, code, type, label, color, isSystem, order, requiresInvoice, requiresNotes, now),
    ),
    ...defaultSystemSettings.map(([key, value]) =>
      db
        .prepare('INSERT OR IGNORE INTO tenant_system_settings (organization_id, key, value, updated_at) VALUES (?, ?, ?, ?)')
        .bind(organizationId, key, value, now),
    ),
  ];
}

export async function ensureOrganizationDefaults(organizationId: string) {
  await ensureSchema();
  const { db } = getBindings();
  await db.batch(organizationSeedOperations(db, organizationId));
}

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const { db } = getBindings();
      await db.batch(statements.map((statement) => db.prepare(statement)));
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare('INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .bind(LEGACY_ORGANIZATION_ID, 'Núcleo de Operação', now, now),
        db.prepare(`INSERT OR IGNORE INTO organization_membership_permissions
          (organization_id, user_id, permission, created_at)
          SELECT m.organization_id, m.user_id, defaults.permission, m.updated_at
          FROM organization_memberships m
          CROSS JOIN (
            SELECT 'returns.view' AS permission
            UNION ALL SELECT 'returns.create'
            UNION ALL SELECT 'returns.edit'
            UNION ALL SELECT 'returns.finalize'
          ) defaults
          WHERE m.role = 'OPERATOR'
            AND NOT EXISTS (
              SELECT 1 FROM organization_membership_permissions existing
              WHERE existing.organization_id = m.organization_id AND existing.user_id = m.user_id
            )`),
        ...organizationSeedOperations(db, LEGACY_ORGANIZATION_ID, now),
      ]);
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function getReturnDetail(id: string, organizationId: string): Promise<ReturnDetail | null> {
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
       LEFT JOIN tenant_status_definitions s ON s.organization_id = r.organization_id AND s.code = r.status
       LEFT JOIN tenant_config_options store_option ON store_option.organization_id = r.organization_id AND store_option.type = 'STORE' AND store_option.label = r.store
       WHERE r.id = ? AND r.organization_id = ?`,
    )
    .bind(id, organizationId)
    .first<Record<string, unknown>>();

  if (!record) return null;

  const [itemsResult, photosResult, videosResult, historyResult, conditionDefinitionsResult] = await Promise.all([
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
      .prepare('SELECT id, actor, action, details, created_at FROM audit_events WHERE return_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 100')
      .bind(id, organizationId)
      .all(),
    db
      .prepare(
        `SELECT o.code, o.type, o.label, o.color, o.is_system, o.sort_order, o.active,
          o.requires_invoice, o.requires_notes
         FROM tenant_config_options o
         WHERE o.organization_id = ? AND o.type = 'CONDITION'
           AND (o.active = 1 OR EXISTS (
             SELECT 1 FROM return_items i WHERE i.return_id = ? AND i.condition = o.code
           ))
         ORDER BY o.active DESC, o.sort_order, o.label`,
      )
      .bind(organizationId, id)
      .all<{
        code: string;
        type: 'CONDITION';
        label: string;
        color: string;
        is_system: number;
        sort_order: number;
        active: number;
        requires_invoice: number;
        requires_notes: number;
      }>(),
  ]);

  const detail = {
    ...record,
    status_label: record.status_label || 'Status não configurado',
    status_color: record.status_color || 'slate',
    items: itemsResult.results,
    photos: photosResult.results,
    videos: videosResult.results,
    history: historyResult.results,
    condition_definitions: conditionDefinitionsResult.results,
  } as unknown as ReturnDetail;

  detail.blockingReasons = getBlockingReasons(
    detail,
    conditionDefinitionsResult.results.filter((condition) => condition.requires_invoice === 0).map((condition) => condition.code),
    conditionDefinitionsResult.results.filter((condition) => condition.requires_notes === 1).map((condition) => condition.code),
  );
  const validConditionCodes = new Set(conditionDefinitionsResult.results.map((condition) => condition.code));
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
