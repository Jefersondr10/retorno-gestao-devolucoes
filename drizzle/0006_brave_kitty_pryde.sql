CREATE TABLE `auth_google_nonces` (
	`nonce_hash` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
