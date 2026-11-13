-- Custom migration: FTS5 search indexes (ARCHITECTURE §5, §18 #17).
-- `trigram` tokenizer because `unicode61` cannot segment Thai; queries shorter than 3 characters
-- fall back to LIKE in the search repository. The FTS tables are self-contained (not external
-- content): `events` / `academy_lessons` have TEXT primary keys, and their implicit rowids may
-- change on VACUUM, so rows are keyed by an UNINDEXED id column and kept in sync by triggers.
-- The FTS tables index every event; the search repository filters to published ones.
CREATE VIRTUAL TABLE `events_fts` USING fts5(
	event_id UNINDEXED,
	title_th,
	summary_th,
	what_happened_th,
	why_it_matters_th,
	background_th,
	tags,
	tokenize = 'trigram'
);
--> statement-breakpoint
CREATE TRIGGER `events_fts_after_insert` AFTER INSERT ON `events` BEGIN
	INSERT INTO events_fts (event_id, title_th, summary_th, what_happened_th, why_it_matters_th, background_th, tags)
	VALUES (
		NEW.id, NEW.title_th, NEW.summary_th, NEW.what_happened_th, NEW.why_it_matters_th,
		coalesce(NEW.background_th, ''),
		(SELECT coalesce(group_concat(value, ' '), '') FROM json_each(NEW.tags))
	);
END;
--> statement-breakpoint
CREATE TRIGGER `events_fts_after_update` AFTER UPDATE OF title_th, summary_th, what_happened_th, why_it_matters_th, background_th, tags ON `events` BEGIN
	DELETE FROM events_fts WHERE event_id = OLD.id;
	INSERT INTO events_fts (event_id, title_th, summary_th, what_happened_th, why_it_matters_th, background_th, tags)
	VALUES (
		NEW.id, NEW.title_th, NEW.summary_th, NEW.what_happened_th, NEW.why_it_matters_th,
		coalesce(NEW.background_th, ''),
		(SELECT coalesce(group_concat(value, ' '), '') FROM json_each(NEW.tags))
	);
END;
--> statement-breakpoint
CREATE TRIGGER `events_fts_after_delete` AFTER DELETE ON `events` BEGIN
	DELETE FROM events_fts WHERE event_id = OLD.id;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `lessons_fts` USING fts5(
	lesson_id UNINDEXED,
	title,
	summary,
	body,
	tokenize = 'trigram'
);
--> statement-breakpoint
CREATE TRIGGER `lessons_fts_after_insert` AFTER INSERT ON `academy_lessons` BEGIN
	INSERT INTO lessons_fts (lesson_id, title, summary, body)
	VALUES (NEW.id, NEW.title, NEW.summary, NEW.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `lessons_fts_after_update` AFTER UPDATE OF title, summary, search_text ON `academy_lessons` BEGIN
	DELETE FROM lessons_fts WHERE lesson_id = OLD.id;
	INSERT INTO lessons_fts (lesson_id, title, summary, body)
	VALUES (NEW.id, NEW.title, NEW.summary, NEW.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `lessons_fts_after_delete` AFTER DELETE ON `academy_lessons` BEGIN
	DELETE FROM lessons_fts WHERE lesson_id = OLD.id;
END;
--> statement-breakpoint
-- Backfill rows that existed before this migration (none on a fresh database).
INSERT INTO events_fts (event_id, title_th, summary_th, what_happened_th, why_it_matters_th, background_th, tags)
SELECT id, title_th, summary_th, what_happened_th, why_it_matters_th, coalesce(background_th, ''),
	(SELECT coalesce(group_concat(value, ' '), '') FROM json_each(events.tags))
FROM events;
--> statement-breakpoint
INSERT INTO lessons_fts (lesson_id, title, summary, body)
SELECT id, title, summary, search_text FROM academy_lessons;
