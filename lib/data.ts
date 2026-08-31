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
  `CREATE INDEX IF NOT EXISTS idx_returns_tracking ON returns(tracking_code)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items(return_id)`,
  `CREATE INDEX IF NOT EXISTS idx_return_photos_return_id ON return_photos(return_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_return_id_created ON audit_events(return_id, created_at)`,
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
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export function actorFrom(request: Request) {
  return (
    request.headers.get('oai-authenticated-user-email') ||
    request.headers.get('oai-authenticated-user-id') ||
    'Equipe Retorno'
  );
}

export async function getReturnDetail(id: string): Promise<ReturnDetail | null> {
  await ensureSchema();
  const { db } = getBindings();
  const record = await db
    .prepare(
      `SELECT r.*, s.label AS status_label, s.color AS status_color,
        (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
        (SELECT COUNT(*) FROM return_photos p WHERE p.return_id = r.id) AS photo_count,
        (SELECT p.id FROM return_photos p WHERE p.return_id = r.id ORDER BY p.created_at LIMIT 1) AS first_photo_id
       FROM returns r
       LEFT JOIN status_definitions s ON s.code = r.status
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>();

  if (!record) return null;

  const [itemsResult, photosResult, historyResult] = await Promise.all([
    db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY rowid').bind(id).all(),
    db
      .prepare('SELECT id, file_name, content_type, size, created_at FROM return_photos WHERE return_id = ? ORDER BY created_at')
      .bind(id)
      .all(),
    db
      .prepare('SELECT id, actor, action, details, created_at FROM audit_events WHERE return_id = ? ORDER BY created_at DESC LIMIT 100')
      .bind(id)
      .all(),
  ]);

  const detail = {
    ...record,
    status_label: record.status_label || record.status,
    status_color: record.status_color || 'slate',
    items: itemsResult.results,
    photos: photosResult.results,
    history: historyResult.results,
  } as unknown as ReturnDetail;

  detail.blockingReasons = getBlockingReasons(detail);
  detail.canFinalize = detail.blockingReasons.length === 0 && detail.status !== 'FINALIZED';
  return detail;
}

export function apiError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}
