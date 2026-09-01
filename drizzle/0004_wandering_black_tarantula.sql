CREATE TABLE `auth_bootstrap` (
	`id` integer PRIMARY KEY NOT NULL,
	`completed_at` text NOT NULL,
	`admin_user_id` text NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_bootstrap_singleton_check" CHECK("auth_bootstrap"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`subject_hash` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`blocked_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`csrf_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expires` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`role` text DEFAULT 'OPERATOR' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('ADMIN', 'OPERATOR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_active_role` ON `users` (`active`,`role`);--> statement-breakpoint
CREATE TRIGGER `users_keep_one_admin_on_update`
BEFORE UPDATE OF role, active ON users
WHEN OLD.role = 'ADMIN' AND OLD.active = 1
  AND NOT (NEW.role = 'ADMIN' AND NEW.active = 1)
  AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id <> OLD.id AND role = 'ADMIN' AND active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
END;--> statement-breakpoint
CREATE TRIGGER `users_keep_one_admin_on_delete`
BEFORE DELETE ON users
WHEN OLD.role = 'ADMIN' AND OLD.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id <> OLD.id AND role = 'ADMIN' AND active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_ADMIN');
END;
