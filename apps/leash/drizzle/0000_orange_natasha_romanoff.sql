CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ceremonies` (
	`id` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`kind` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`site_user_id` text NOT NULL,
	`action` text NOT NULL,
	`params` text NOT NULL,
	`params_hash` text NOT NULL,
	`summary` text NOT NULL,
	`reason` text NOT NULL,
	`return_url` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`proof_jti` text,
	`approved_at` integer,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `challenges_site_user_idx` ON `challenges` (`site_id`,`site_user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `challenges_proof_jti_unique` ON `challenges` (`proof_jti`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`site_user_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`params` text NOT NULL,
	`summary` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_counter_idx` ON `events` (`site_id`,`site_user_id`,`action`,`outcome`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_user_idx` ON `events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`site_user_id` text NOT NULL,
	`policy` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_site_user_unique` ON `links` (`site_id`,`site_user_id`);--> statement-breakpoint
CREATE INDEX `links_user_idx` ON `links` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_user_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credential_unique` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `signing_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`private_jwk` text NOT NULL,
	`public_jwk` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`secret_hash` text NOT NULL,
	`manifest` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
