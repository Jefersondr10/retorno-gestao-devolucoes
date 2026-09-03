CREATE TABLE `user_release_acknowledgements` (
	`user_id` text NOT NULL,
	`release_id` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `release_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
