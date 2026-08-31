CREATE TABLE `return_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`duration_ms` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_return_videos_return_id` ON `return_videos` (`return_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_return_videos_object_key` ON `return_videos` (`object_key`);