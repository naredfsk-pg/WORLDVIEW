-- Auto-publish wave: the `reevaluate_pending` job type (job_runs CHECK), its admin rerun action
-- (admin_actions CHECK) and the public credibility label on events.
-- Drizzle's migrator runs every migration inside one transaction, where `PRAGMA foreign_keys` is a
-- no-op, so foreign keys stay ON here. Dropping `job_runs` would then fire
-- `llm_calls.job_run_id ON DELETE SET NULL` for every LLM call, so those links are saved first
-- and written back after the rebuild.
CREATE TABLE `__new_admin_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`target` text NOT NULL,
	`reason` text NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" IN ('rerun_ingest', 'rerun_digest', 'rerun_brief_morning', 'rerun_brief_evening', 'rerun_archive_snapshot', 'rerun_reevaluate_pending'))
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "created_at", "action", "actor", "target", "reason") SELECT "id", "created_at", "action", "actor", "target", "reason" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
CREATE INDEX `admin_actions_action_created_at_idx` ON `admin_actions` (`action`,`created_at`);--> statement-breakpoint
CREATE TEMP TABLE `__llm_call_job_runs` AS SELECT `id`, `job_run_id` FROM `llm_calls` WHERE `job_run_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`trigger` text NOT NULL,
	`attempts` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`counters` text NOT NULL,
	`error` text,
	CONSTRAINT "job_runs_status_check" CHECK("__new_job_runs"."status" IN ('running', 'succeeded', 'partial', 'failed')),
	CONSTRAINT "job_runs_type_check" CHECK("__new_job_runs"."job_type" IN ('ingest', 'digest', 'brief_morning', 'brief_evening', 'archive_snapshot', 'reevaluate_pending'))
);
--> statement-breakpoint
INSERT INTO `__new_job_runs`("id", "job_type", "idempotency_key", "scheduled_for", "trigger", "attempts", "started_at", "finished_at", "status", "counters", "error") SELECT "id", "job_type", "idempotency_key", "scheduled_for", "trigger", "attempts", "started_at", "finished_at", "status", "counters", "error" FROM `job_runs`;--> statement-breakpoint
DROP TABLE `job_runs`;--> statement-breakpoint
ALTER TABLE `__new_job_runs` RENAME TO `job_runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_idempotency_key_unique` ON `job_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `job_runs_type_finished_at_idx` ON `job_runs` (`job_type`,`finished_at`);--> statement-breakpoint
CREATE INDEX `job_runs_started_at_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
UPDATE `llm_calls` SET `job_run_id` = (SELECT `saved`.`job_run_id` FROM `__llm_call_job_runs` AS `saved` WHERE `saved`.`id` = `llm_calls`.`id`) WHERE `id` IN (SELECT `id` FROM `__llm_call_job_runs`);--> statement-breakpoint
DROP TABLE `__llm_call_job_runs`;--> statement-breakpoint
-- Added columns, so `events` is not rebuilt (that would drop the FTS triggers of 0001). The CHECK
-- is inline here and not in schema.ts for the same reason (drizzle-kit would rebuild the table).
ALTER TABLE `events` ADD `credibility_level` text DEFAULT 'none' NOT NULL CONSTRAINT "events_credibility_level_check" CHECK(`credibility_level` IN ('none', 'unverified', 'disputed', 'possible_misinformation'));--> statement-breakpoint
ALTER TABLE `events` ADD `credibility_reason_th` text;
