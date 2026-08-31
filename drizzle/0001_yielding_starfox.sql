CREATE TABLE `config_options` (
	`code` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`requires_invoice` integer DEFAULT true NOT NULL,
	`requires_notes` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_config_options_type_label` ON `config_options` (`type`,`label`);--> statement-breakpoint
CREATE INDEX `idx_config_options_type_active` ON `config_options` (`type`,`active`,`sort_order`);