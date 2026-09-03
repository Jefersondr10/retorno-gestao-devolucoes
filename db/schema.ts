import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const returnSequences = sqliteTable('return_sequences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
});

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const statusDefinitions = sqliteTable(
  'tenant_status_definitions',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    color: text('color').notNull().default('slate'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(100),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.code] }),
    uniqueIndex('idx_tenant_status_org_code').on(table.organizationId, table.code),
    index('idx_tenant_status_org_active').on(table.organizationId, table.active, table.sortOrder),
  ],
);

export const configOptions = sqliteTable(
  'tenant_config_options',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
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
    primaryKey({ columns: [table.organizationId, table.code] }),
    uniqueIndex('idx_tenant_config_org_code').on(table.organizationId, table.code),
    uniqueIndex('idx_tenant_config_org_type_label').on(table.organizationId, table.type, table.label),
    index('idx_tenant_config_org_type_active').on(table.organizationId, table.type, table.active, table.sortOrder),
  ],
);

export const systemSettings = sqliteTable(
  'tenant_system_settings',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.key] }),
    uniqueIndex('idx_tenant_settings_org_key').on(table.organizationId, table.key),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
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
    uniqueIndex('idx_users_email_nocase')
      .on(sql`${table.email} COLLATE NOCASE`)
      .where(sql`${table.email} IS NOT NULL`),
    uniqueIndex('idx_users_google_sub').on(table.googleSub),
    index('idx_users_google_email').on(table.googleEmail),
    index('idx_users_approval_status').on(table.approvalStatus, table.active),
    index('idx_users_active_role').on(table.active, table.role),
    check('users_role_check', sql`${table.role} IN ('ADMIN', 'OPERATOR')`),
  ],
);

export const organizationMemberships = sqliteTable(
  'organization_memberships',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('OPERATOR'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    uniqueIndex('idx_memberships_org_user').on(table.organizationId, table.userId),
    index('idx_memberships_user_status').on(table.userId, table.status),
    index('idx_memberships_org_status_role').on(table.organizationId, table.status, table.role),
    uniqueIndex('idx_memberships_one_active_org').on(table.userId).where(sql`${table.status} = 'ACTIVE'`),
    check('membership_role_check', sql`${table.role} IN ('ADMIN', 'OPERATOR')`),
    check('membership_status_check', sql`${table.status} IN ('ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED')`),
  ],
);

export const organizationMembershipPermissions = sqliteTable(
  'organization_membership_permissions',
  {
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    permission: text('permission').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId, table.permission] }),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.userId],
      name: 'membership_permissions_membership_fk',
    }).onDelete('cascade'),
    check(
      'membership_permission_value_check',
      sql`${table.permission} IN ('returns.view', 'returns.create', 'returns.edit', 'returns.finalize', 'returns.delete', 'settings.manage', 'retention.manage', 'team.manage')`,
    ),
  ],
);

export const organizationQuotaReservations = sqliteTable(
  'organization_quota_reservations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    returnId: text('return_id').notNull(),
    returnCount: integer('return_count').notNull().default(1),
    mediaBytes: integer('media_bytes').notNull().default(0),
    objectKeysJson: text('object_keys_json').notNull().default('[]'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_quota_reservations_org_expires').on(table.organizationId, table.expiresAt),
    uniqueIndex('idx_quota_reservations_return_id').on(table.returnId),
    check('quota_reservation_return_count_check', sql`${table.returnCount} > 0`),
    check('quota_reservation_media_bytes_check', sql`${table.mediaBytes} >= 0`),
    check(
      'quota_reservation_object_keys_json_check',
      sql`json_valid(${table.objectKeysJson}) = 1 AND json_type(${table.objectKeysJson}) = 'array'`,
    ),
  ],
);

export const userReleaseAcknowledgements = sqliteTable(
  'user_release_acknowledgements',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    releaseId: text('release_id').notNull(),
    acknowledgedAt: text('acknowledged_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.releaseId] }),
  ],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' }),
    csrfHash: text('csrf_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    index('idx_auth_sessions_user').on(table.userId),
    index('idx_auth_sessions_organization').on(table.organizationId),
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

export const authGoogleOnboarding = sqliteTable(
  'auth_google_onboarding',
  {
    tokenHash: text('token_hash').primaryKey(),
    googleSub: text('google_sub').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_google_onboarding_sub').on(table.googleSub)],
);

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
    organizationId: text('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' }),
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
    index('idx_returns_org_status_received').on(table.organizationId, table.status, table.receivedAt),
    index('idx_returns_org_status_finalized').on(table.organizationId, table.status, table.finalizedAt),
    index('idx_returns_org_tracking').on(table.organizationId, table.trackingCode),
    index('idx_returns_org_order').on(table.organizationId, table.orderId),
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
    organizationId: text('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' }),
    returnId: text('return_id').references(() => returns.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    details: text('details'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_events_org_created').on(table.organizationId, table.createdAt),
    index('idx_audit_events_return_id_created').on(table.returnId, table.createdAt),
  ],
);
