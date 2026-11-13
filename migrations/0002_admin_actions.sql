CREATE TABLE `admin_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`target` text NOT NULL,
	`reason` text NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("admin_actions"."action" IN ('rerun_ingest'))
);
--> statement-breakpoint
CREATE INDEX `admin_actions_action_created_at_idx` ON `admin_actions` (`action`,`created_at`);