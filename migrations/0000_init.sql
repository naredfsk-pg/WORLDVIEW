CREATE TABLE `academy_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`week` integer NOT NULL,
	`day` integer NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`content_path` text NOT NULL,
	`tags` text NOT NULL,
	`categories` text NOT NULL,
	`search_text` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`publisher_name` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`language` text,
	`published_at` text,
	`ingested_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`raw_metadata` text NOT NULL,
	`taxonomy` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_canonical_url_unique` ON `articles` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `articles_content_hash_idx` ON `articles` (`content_hash`);--> statement-breakpoint
CREATE INDEX `articles_published_at_idx` ON `articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `articles_ingested_at_idx` ON `articles` (`ingested_at`);--> statement-breakpoint
CREATE INDEX `articles_source_id_idx` ON `articles` (`source_id`);--> statement-breakpoint
CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`changed_at` text NOT NULL,
	`changed_by` text NOT NULL,
	`change_reason` text NOT NULL,
	`public_note_th` text,
	`before_after` text NOT NULL,
	CONSTRAINT "content_revisions_entity_type_check" CHECK("content_revisions"."entity_type" IN ('event', 'event_relation', 'event_lesson_link', 'daily_brief'))
);
--> statement-breakpoint
CREATE INDEX `content_revisions_entity_idx` ON `content_revisions` (`entity_type`,`entity_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `daily_brief_events` (
	`brief_id` text NOT NULL,
	`event_id` text NOT NULL,
	`rank` integer NOT NULL,
	`selection_reason` text NOT NULL,
	PRIMARY KEY(`brief_id`, `event_id`),
	FOREIGN KEY (`brief_id`) REFERENCES `daily_briefs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_brief_events_rank_check" CHECK("daily_brief_events"."rank" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_brief_events_brief_rank_unique` ON `daily_brief_events` (`brief_id`,`rank`);--> statement-breakpoint
CREATE INDEX `daily_brief_events_event_id_idx` ON `daily_brief_events` (`event_id`);--> statement-breakpoint
CREATE TABLE `daily_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_date` text NOT NULL,
	`edition` text NOT NULL,
	`status` text NOT NULL,
	`generated_at` text NOT NULL,
	`published_at` text,
	`event_count` integer NOT NULL,
	CONSTRAINT "daily_briefs_edition_check" CHECK("daily_briefs"."edition" IN ('morning', 'evening', 'daily_snapshot')),
	CONSTRAINT "daily_briefs_status_check" CHECK("daily_briefs"."status" IN ('draft', 'published', 'hidden'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_briefs_date_edition_unique` ON `daily_briefs` (`brief_date`,`edition`);--> statement-breakpoint
CREATE INDEX `daily_briefs_status_published_at_idx` ON `daily_briefs` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `event_articles` (
	`event_id` text NOT NULL,
	`article_id` text NOT NULL,
	`relation_confidence` real NOT NULL,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`event_id`, `article_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_articles_article_id_unique` ON `event_articles` (`article_id`);--> statement-breakpoint
CREATE TABLE `event_lesson_links` (
	`event_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`rationale_th` text NOT NULL,
	`evidence_refs` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`event_id`, `lesson_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `academy_lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_lesson_links_lesson_id_idx` ON `event_lesson_links` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `event_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`from_event_id` text NOT NULL,
	`to_event_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`explanation_th` text NOT NULL,
	`evidence_refs` text NOT NULL,
	`status` text NOT NULL,
	`confidence` real NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	FOREIGN KEY (`from_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_relations_type_check" CHECK("event_relations"."relation_type" IN ('same_topic', 'follow_up', 'response_to', 'background_of', 'potential_impact')),
	CONSTRAINT "event_relations_status_check" CHECK("event_relations"."status" IN ('pending_review', 'published', 'rejected')),
	CONSTRAINT "event_relations_no_self_edge" CHECK("event_relations"."from_event_id" <> "event_relations"."to_event_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_relations_edge_unique` ON `event_relations` (`from_event_id`,`to_event_id`,`relation_type`);--> statement-breakpoint
CREATE INDEX `event_relations_to_event_id_idx` ON `event_relations` (`to_event_id`);--> statement-breakpoint
CREATE INDEX `event_relations_status_created_at_idx` ON `event_relations` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `event_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`occurred_at` text,
	`reported_at` text NOT NULL,
	`update_text_th` text NOT NULL,
	`evidence_refs` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_updates_event_id_reported_at_idx` ON `event_updates` (`event_id`,`reported_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`review_reasons` text NOT NULL,
	`title_th` text NOT NULL,
	`summary_th` text NOT NULL,
	`what_happened_th` text NOT NULL,
	`why_it_matters_th` text NOT NULL,
	`background_th` text,
	`uncertain_th` text,
	`claims` text NOT NULL,
	`category` text,
	`regions` text NOT NULL,
	`countries` text NOT NULL,
	`tags` text NOT NULL,
	`signals` text,
	`occurred_at` text,
	`first_seen_at` text NOT NULL,
	`event_date` text NOT NULL,
	`last_updated_at` text NOT NULL,
	`published_at` text,
	`summarized_at` text,
	`source_count` integer NOT NULL,
	`is_demo` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "events_status_check" CHECK("events"."status" IN ('draft', 'pending_review', 'published', 'hidden')),
	CONSTRAINT "events_category_check" CHECK("events"."category" IS NULL OR "events"."category" IN ('geopolitics', 'economy', 'technology', 'energy', 'society')),
	CONSTRAINT "events_source_count_check" CHECK("events"."source_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `events_status_event_date_idx` ON `events` (`status`,`event_date`);--> statement-breakpoint
CREATE INDEX `events_category_idx` ON `events` (`category`);--> statement-breakpoint
CREATE INDEX `events_last_updated_at_idx` ON `events` (`last_updated_at`);--> statement-breakpoint
CREATE TABLE `job_runs` (
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
	CONSTRAINT "job_runs_status_check" CHECK("job_runs"."status" IN ('running', 'succeeded', 'partial', 'failed')),
	CONSTRAINT "job_runs_type_check" CHECK("job_runs"."job_type" IN ('ingest', 'digest', 'brief_morning', 'brief_evening', 'archive_snapshot'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_idempotency_key_unique` ON `job_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `job_runs_type_finished_at_idx` ON `job_runs` (`job_type`,`finished_at`);--> statement-breakpoint
CREATE INDEX `job_runs_started_at_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`cache_key` text NOT NULL,
	`status` text NOT NULL,
	`error_kind` text,
	`tokens_in` integer NOT NULL,
	`tokens_out` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`output_json` text,
	`job_run_id` text,
	FOREIGN KEY (`job_run_id`) REFERENCES `job_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `llm_calls_cache_key_status_idx` ON `llm_calls` (`cache_key`,`status`);--> statement-breakpoint
CREATE INDEX `llm_calls_created_at_idx` ON `llm_calls` (`created_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`homepage_url` text NOT NULL,
	`feed_url` text NOT NULL,
	`license_notes` text NOT NULL,
	`allow_excerpt` integer NOT NULL,
	`is_demo` integer NOT NULL,
	`enabled` integer NOT NULL,
	`last_success_at` text,
	`last_error_at` text,
	`last_error` text,
	CONSTRAINT "sources_kind_check" CHECK("sources"."kind" IN ('rss', 'fixture'))
);
