PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`target` text NOT NULL,
	`reason` text NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" IN ('rerun_ingest', 'rerun_digest', 'rerun_brief_morning', 'rerun_brief_evening', 'rerun_archive_snapshot'))
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "created_at", "action", "actor", "target", "reason") SELECT "id", "created_at", "action", "actor", "target", "reason" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `admin_actions_action_created_at_idx` ON `admin_actions` (`action`,`created_at`);