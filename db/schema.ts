import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const returnSequences = sqliteTable('return_sequences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
});

export const statusDefinitions = sqliteTable('status_definitions', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  color: text('color').notNull().default('slate'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const configOptions = sqliteTable(
  'config_options',
  {
    code: text('code').primaryKey(),
    type: text('type').notNull(),
    label: text('label').notNull(),
    color: text('color').notNull().default('#64748b'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(100),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    requiresInvoice: integer('requires_invoice', { mode: 'boolean' }).notNull().default(true),
    requiresNotes: integer('requires_notes', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_config_options_type_label').on(table.type, table.label),
    index('idx_config_options_type_active').on(table.type, table.active, table.sortOrder),
  ],
);

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    googleSub: text('google_sub'),
    googleEmail: text('google_email'),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    passwordIterations: integer('password_iterations').notNull(),
    passwordLoginEnabled: integer('password_login_enabled', { mode: 'boolean' }).notNull().default(true),
    approvalStatus: text('approval_status').notNull().default('APPROVED'),
    role: text('role').notNull().default('OPERATOR'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(true),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_username').on(table.username),
    uniqueIndex('idx_users_google_sub').on(table.googleSub),
    index('idx_users_google_email').on(table.googleEmail),
    index('idx_users_approval_status').on(table.approvalStatus, table.active),
    index('idx_users_active_role').on(table.active, table.role),
    check('users_role_check', sql`${table.role} IN ('ADMIN', 'OPERATOR')`),
  ],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfHash: text('csrf_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    index('idx_auth_sessions_user').on(table.userId),
    index('idx_auth_sessions_expires').on(table.expiresAt),
  ],
);

export const authRateLimits = sqliteTable('auth_rate_limits', {
  subjectHash: text('subject_hash').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  windowStartedAt: text('window_started_at').notNull(),
  blockedUntil: text('blocked_until'),
  updatedAt: text('updated_at').notNull(),
});

export const authGoogleNonces = sqliteTable('auth_google_nonces', {
  nonceHash: text('nonce_hash').primaryKey(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const authBootstrap = sqliteTable(
  'auth_bootstrap',
  {
    id: integer('id').primaryKey(),
    completedAt: text('completed_at').notNull(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => users.id),
  },
  (table) => [check('auth_bootstrap_singleton_check', sql`${table.id} = 1`)],
);

export const returns = sqliteTable(
  'returns',
  {
    id: text('id').primaryKey(),
    protocol: text('protocol').notNull(),
    store: text('store'),
    receivedLocation: text('received_location').notNull(),
    receivedAt: text('received_at').notNull(),
    orderId: text('order_id'),
    trackingCode: text('tracking_code'),
    status: text('status').notNull().default('PENDING_INFO'),
    notes: text('notes'),
    source: text('source').notNull().default('MANUAL'),
    invoiceNumber: text('invoice_number'),
    invoiceDate: text('invoice_date'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: text('updated_at').notNull(),
    finalizedBy: text('finalized_by'),
    finalizedAt: text('finalized_at'),
  },
  (table) => [
    uniqueIndex('idx_returns_protocol').on(table.protocol),
    index('idx_returns_status_received').on(table.status, table.receivedAt),
    index('idx_returns_status_finalized').on(table.status, table.finalizedAt),
    index('idx_returns_tracking').on(table.trackingCode),
    index('idx_returns_order').on(table.orderId),
  ],
);

export const returnItems = sqliteTable(
  'return_items',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    product: text('product').notNull(),
    sku: text('sku'),
    quantity: integer('quantity').notNull().default(1),
    condition: text('condition'),
    conditionNotes: text('condition_notes'),
    destination: text('destination'),
    testResult: text('test_result'),
    notes: text('notes'),
  },
  (table) => [index('idx_return_items_return_id').on(table.returnId)],
);

export const returnPhotos = sqliteTable(
  'return_photos',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_return_photos_return_id').on(table.returnId)],
);

export const returnVideos = sqliteTable(
  'return_videos',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    durationMs: integer('duration_ms'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_return_videos_return_id').on(table.returnId),
    uniqueIndex('idx_return_videos_object_key').on(table.objectKey),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id').references(() => returns.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    details: text('details'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_audit_events_return_id_created').on(table.returnId, table.createdAt)],
);
