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
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`secret_hash` text NOT NULL,
	`manifest` text NOT NULL,
	`updated_at` integer NOT NULL
);
