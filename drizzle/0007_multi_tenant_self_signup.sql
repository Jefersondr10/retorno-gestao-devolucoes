CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `organizations` (`id`, `name`, `created_at`, `updated_at`)
VALUES ('org_nucleo_legacy', 'Núcleo de Operação', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;
--> statement-breakpoint
UPDATE `users`
SET `email` = LOWER(`google_email`)
WHERE `google_email` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `users` AS duplicate
    WHERE duplicate.`id` <> `users`.`id`
      AND LOWER(duplicate.`google_email`) = LOWER(`users`.`google_email`)
  );
--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`role` text DEFAULT 'OPERATOR' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`organization_id`, `user_id`),
	CHECK (`role` IN ('ADMIN', 'OPERATOR')),
	CHECK (`status` IN ('ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_memberships`
(`organization_id`, `user_id`, `role`, `status`, `created_at`, `updated_at`)
SELECT 'org_nucleo_legacy', `id`, `role`,
  CASE
    WHEN `approval_status` <> 'APPROVED' OR `active` = 0 THEN 'SUSPENDED'
    ELSE 'ACTIVE'
  END,
  `created_at`, `updated_at`
FROM `users`;
--> statement-breakpoint
UPDATE `users` SET `active` = 1, `approval_status` = 'APPROVED';
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `organization_id` text REFERENCES `organizations`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE `auth_sessions` SET `organization_id` = 'org_nucleo_legacy' WHERE `organization_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `returns` ADD `organization_id` text REFERENCES `organizations`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE `returns` SET `organization_id` = 'org_nucleo_legacy' WHERE `organization_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `organization_id` text REFERENCES `organizations`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE `audit_events` SET `organization_id` = 'org_nucleo_legacy' WHERE `organization_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `tenant_status_definitions` (
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	PRIMARY KEY (`organization_id`, `code`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `tenant_status_definitions`
(`organization_id`, `code`, `label`, `color`, `is_system`, `sort_order`, `active`)
SELECT 'org_nucleo_legacy', `code`, `label`, `color`, `is_system`, `sort_order`, `active`
FROM `status_definitions`;
--> statement-breakpoint
CREATE TABLE `tenant_config_options` (
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`requires_invoice` integer DEFAULT true NOT NULL,
	`requires_notes` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`organization_id`, `code`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `tenant_config_options`
(`organization_id`, `code`, `type`, `label`, `color`, `is_system`, `sort_order`, `active`, `requires_invoice`, `requires_notes`, `created_at`)
SELECT 'org_nucleo_legacy', `code`, `type`, `label`, `color`, `is_system`, `sort_order`, `active`, `requires_invoice`, `requires_notes`, `created_at`
FROM `config_options`;
--> statement-breakpoint
CREATE TABLE `tenant_system_settings` (
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`organization_id`, `key`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `tenant_system_settings` (`organization_id`, `key`, `value`, `updated_at`)
SELECT 'org_nucleo_legacy', `key`, `value`, `updated_at` FROM `system_settings`;
--> statement-breakpoint
CREATE TABLE `auth_google_onboarding` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_google_onboarding_sub` ON `auth_google_onboarding` (`google_sub`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenant_status_org_code` ON `tenant_status_definitions` (`organization_id`, `code`);
--> statement-breakpoint
CREATE INDEX `idx_tenant_status_org_active` ON `tenant_status_definitions` (`organization_id`, `active`, `sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenant_config_org_code` ON `tenant_config_options` (`organization_id`, `code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenant_config_org_type_label` ON `tenant_config_options` (`organization_id`, `type`, `label`);
--> statement-breakpoint
CREATE INDEX `idx_tenant_config_org_type_active` ON `tenant_config_options` (`organization_id`, `type`, `active`, `sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenant_settings_org_key` ON `tenant_system_settings` (`organization_id`, `key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email_nocase` ON `users` (`email` COLLATE NOCASE) WHERE `email` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memberships_org_user` ON `organization_memberships` (`organization_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `idx_memberships_user_status` ON `organization_memberships` (`user_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_memberships_org_status_role` ON `organization_memberships` (`organization_id`, `status`, `role`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memberships_one_active_org` ON `organization_memberships` (`user_id`) WHERE `status` = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_organization` ON `auth_sessions` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_returns_org_status_received` ON `returns` (`organization_id`, `status`, `received_at`);
--> statement-breakpoint
CREATE INDEX `idx_returns_org_status_finalized` ON `returns` (`organization_id`, `status`, `finalized_at`);
--> statement-breakpoint
CREATE INDEX `idx_returns_org_tracking` ON `returns` (`organization_id`, `tracking_code`);
--> statement-breakpoint
CREATE INDEX `idx_returns_org_order` ON `returns` (`organization_id`, `order_id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_org_created` ON `audit_events` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `auth_sessions_require_organization_insert`
BEFORE INSERT ON `auth_sessions` WHEN NEW.`organization_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `auth_sessions_require_organization_update`
BEFORE UPDATE OF `organization_id` ON `auth_sessions` WHEN NEW.`organization_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `returns_require_organization_insert`
BEFORE INSERT ON `returns` WHEN NEW.`organization_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `returns_require_organization_update`
BEFORE UPDATE OF `organization_id` ON `returns` WHEN NEW.`organization_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_require_organization_insert`
BEFORE INSERT ON `audit_events` WHEN NEW.`organization_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_require_organization_update`
BEFORE UPDATE OF `organization_id` ON `audit_events` WHEN NEW.`organization_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZATION_REQUIRED');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `users_keep_one_admin_on_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `users_keep_one_admin_on_delete`;
--> statement-breakpoint
CREATE TRIGGER `memberships_keep_one_admin_on_update`
BEFORE UPDATE OF `role`, `status`, `organization_id` ON `organization_memberships`
WHEN OLD.`role` = 'ADMIN' AND OLD.`status` = 'ACTIVE'
  AND NOT (NEW.`role` = 'ADMIN' AND NEW.`status` = 'ACTIVE' AND NEW.`organization_id` = OLD.`organization_id`)
  AND NOT EXISTS (
    SELECT 1 FROM `organization_memberships`
    WHERE `user_id` <> OLD.`user_id` AND `organization_id` = OLD.`organization_id`
      AND `role` = 'ADMIN' AND `status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
END;
--> statement-breakpoint
CREATE TRIGGER `memberships_keep_one_admin_on_delete`
BEFORE DELETE ON `organization_memberships`
WHEN OLD.`role` = 'ADMIN' AND OLD.`status` = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM `organization_memberships`
    WHERE `user_id` <> OLD.`user_id` AND `organization_id` = OLD.`organization_id`
      AND `role` = 'ADMIN' AND `status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
END;
