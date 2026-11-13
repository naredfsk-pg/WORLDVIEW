/**
 * Scheduled job contracts. Implemented in `#lib/server/jobs`; CLI entrypoint `scripts/job.ts`.
 */
import type { BriefDate, BriefEdition, IsoUtc, JsonObject } from './domain';

export const JOB_TYPES = [
	'ingest',
	'digest',
	'brief_morning',
	'brief_evening',
	'archive_snapshot',
	// CONTRACT-CHANGE (auto-publish wave): re-runs the publish gate with the current
	// EDITORIAL_AUTO_PUBLISH policy for events held only by a policy reason, and the relation
	// rule for pending relations. Manual only (CLI or /admin/jobs), never in the crontab.
	'reevaluate_pending'
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** `partial` = finished but some units failed (e.g. 1 of 5 sources, or some events fell back to review). */
export const JOB_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRIGGERS = ['cron', 'manual'] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const JOB_COUNTER_KEYS = [
	// ingest
	'sources_ok',
	'sources_failed',
	'items_fetched',
	'items_dropped',
	'articles_inserted',
	'duplicates_url',
	'duplicates_content',
	// CONTRACT-CHANGE (security wave): new items left for a later run by the per-source cap.
	'items_capped',
	// digest
	'articles_grouped',
	'events_created',
	'events_updated',
	'events_published',
	'events_pending_review',
	// CONTRACT-CHANGE (security wave): published events flagged `new_evidence_pending`, and
	// events whose save was skipped because the row changed while the LLM worked.
	'events_new_evidence',
	'events_skipped',
	'relations_published',
	'relations_pending_review',
	'relations_dropped',
	'lesson_links',
	// llm (digest)
	'llm_requests',
	'llm_cache_hits',
	'llm_failures',
	'llm_tokens',
	// briefs / archive
	'brief_candidates',
	'brief_events',
	// CONTRACT-CHANGE (auto-publish wave): reevaluate_pending (it also uses events_published,
	// events_pending_review, events_skipped and the relations_* keys).
	'events_reevaluated',
	'events_requeued',
	'relations_reevaluated',
	'relations_skipped'
] as const;
export type JobCounterKey = (typeof JOB_COUNTER_KEYS)[number];
export type JobCounters = Partial<Record<JobCounterKey, number>>;

/** Row of `job_runs`. UNIQUE(idempotency_key). One row per logical slot; reruns update it. */
export interface JobRun {
	id: string;
	job_type: JobType;
	/** See ARCHITECTURE §8: "ingest:2026-11-13T06", "brief_morning:2026-11-13", "archive_snapshot:2026-11-12". */
	idempotency_key: string;
	scheduled_for: IsoUtc;
	trigger: JobTrigger;
	/** Incremented on every (re)claim of the slot. */
	attempts: number;
	started_at: IsoUtc;
	finished_at: IsoUtc | null;
	status: JobStatus;
	counters: JobCounters;
	/** Sanitized summary; per-unit errors go to structured logs. */
	error: string | null;
}

export interface ClaimJobInput {
	job_type: JobType;
	idempotency_key: string;
	scheduled_for: IsoUtc;
	trigger: JobTrigger;
	/** Re-run a slot that already `succeeded`/`partial`. Never steals a live `running` claim. */
	force: boolean;
	now: IsoUtc;
}

export type ClaimJobResult =
	| { claimed: true; run: JobRun }
	| { claimed: false; reason: 'already_done' | 'running'; existing: JobRun };

export interface JobOutcome {
	status: Exclude<JobStatus, 'running'>;
	counters: JobCounters;
	error: string | null;
}

/** Brief candidate window, [start_utc, end_utc). */
export interface BriefWindow {
	brief_date: BriefDate;
	edition: BriefEdition;
	start_utc: IsoUtc;
	end_utc: IsoUtc;
}

export interface RetryPolicy {
	/** Total attempts including the first. */
	max_attempts: number;
	base_delay_ms: number;
	max_delay_ms: number;
}

/** Structured JSON logger (one line per record). Never pass secrets or licensed article text. */
export interface Logger {
	info(message: string, fields?: JsonObject): void;
	warn(message: string, fields?: JsonObject): void;
	error(message: string, fields?: JsonObject): void;
}

/** Everything time/IO-related a job needs, injected so tests can fake the clock. */
export interface JobContext {
	run: JobRun;
	now: () => Date;
	logger: Logger;
	signal: AbortSignal;
}

/** Parsed CLI: `npm run job -- <job_type> [--date YYYY-MM-DD] [--force] [--manual]` (`--manual` → trigger "manual"). */
export interface JobCliArgs {
	job_type: JobType;
	/** Target brief date for brief_* / archive_snapshot; default derived from now (ARCHITECTURE §8). */
	date: BriefDate | null;
	force: boolean;
	trigger: JobTrigger;
}
