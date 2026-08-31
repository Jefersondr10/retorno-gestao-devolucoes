CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`details` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_return_id_created` ON `audit_events` (`return_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`product` text NOT NULL,
	`sku` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`condition` text,
	`condition_notes` text,
	`destination` text,
	`test_result` text,
	`notes` text,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_return_items_return_id` ON `return_items` (`return_id`);--> statement-breakpoint
CREATE TABLE `return_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_return_photos_return_id` ON `return_photos` (`return_id`);--> statement-breakpoint
CREATE TABLE `return_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`protocol` text NOT NULL,
	`store` text,
	`received_location` text NOT NULL,
	`received_at` text NOT NULL,
	`order_id` text,
	`tracking_code` text,
	`status` text DEFAULT 'PENDING_INFO' NOT NULL,
	`notes` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`invoice_number` text,
	`invoice_date` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`finalized_by` text,
	`finalized_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_returns_protocol` ON `returns` (`protocol`);--> statement-breakpoint
CREATE INDEX `idx_returns_status_received` ON `returns` (`status`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_returns_tracking` ON `returns` (`tracking_code`);--> statement-breakpoint
CREATE INDEX `idx_returns_order` ON `returns` (`order_id`);--> statement-breakpoint
CREATE TABLE `status_definitions` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
