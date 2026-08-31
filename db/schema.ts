import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
