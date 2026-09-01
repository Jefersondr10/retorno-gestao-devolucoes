ALTER TABLE `users` ADD `google_sub` text;--> statement-breakpoint
ALTER TABLE `users` ADD `google_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_login_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `approval_status` text DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_google_sub` ON `users` (`google_sub`);--> statement-breakpoint
CREATE INDEX `idx_users_google_email` ON `users` (`google_email`);--> statement-breakpoint
CREATE INDEX `idx_users_approval_status` ON `users` (`approval_status`,`active`);