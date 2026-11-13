# 5 · backend · auto-publish-credibility

| Field | Value |
|---|---|
| Started | 2026-11-13 20:24:05 (Asia/Bangkok) |
| Finished | 2026-11-13 21:15:00 (Asia/Bangkok) |
| Status | done |
| Agent type | backend (งาน UI มอบให้ subagent `frontend` หนึ่งตัวใน worktree เดียวกัน) |

## Goal
ทำตาม owner decision 2026-11-13: เผยแพร่ข่าวอัตโนมัติทั้งหมด (production `EDITORIAL_AUTO_PUBLISH=all`) โดยไม่มีคนอนุมัติข่าว แต่ติด **ป้ายความน่าเชื่อถือ** แทน บน branch `feature/auto-publish-credibility` (worktree `C:\Project\WORLDVIEW-worktrees\auto-publish`, จาก `main` @ `4df019a`):
1. ป้าย `none` / `unverified` / `disputed` / `possible_misinformation` พร้อมเหตุผลภาษาไทย (LLM + floor แบบ deterministic)
2. G6 ไม่บล็อกในโหมด `all`
3. แสดงป้ายบนหน้าเว็บ
4. กฎลำดับ brief
5. relation เผยแพร่ตาม confidence
6. job `reevaluate_pending` สำหรับ backlog
7. admin override
8. config/ops/docs

## What I did (in order)
1. 20:24 — อ่าน ARCHITECTURE (ทั้งไฟล์), event-gate, relation-gate, text, digest / digest-content / digest-links, digest repository, admin repository + forms, brief-ranking, registry, cli-args, config, schema, migrations 0000–0004 และ git history ของ relation gate (threshold เดิม 0.6) `npm ci`, `npm run db:reset`, baseline `vitest`: 64 files, 1042 passed
2. 20:30 — ออกแบบ:
   - ใส่ credibility ใน **summary** (summary@5) เพราะ summary เห็นทั้ง articles และ extraction claims และเขียนภาษาไทยอยู่แล้ว
   - floor + ทำความสะอาด reason เป็น pure function `assessCredibility`
   - relation อยู่ใต้สวิตช์เดียวกับข่าว (`all` → publish/drop ตาม threshold; `off` / `multi_source` → pending เหมือนเดิม)
   - backlog ใช้ข้อความที่เก็บไว้ ไม่เรียก LLM
3. 20:33 — Types: `CREDIBILITY_LEVELS` / `CREDIBILITY_LABEL_TH` ใน `domain.ts`, field ใน `NewsEvent`, `EventSummary`, `AdminEventRow`; schema columns; job type `reevaluate_pending` + `rerun_reevaluate_pending`
4. 20:36 — `drizzle-kit generate` → อ่าน SQL ที่ได้ พบว่า rebuild `job_runs` หลัง `PRAGMA foreign_keys=ON` และ migrator ของ drizzle รันใน transaction เดียว (PRAGMA ไม่มีผล) ซึ่งจะทำให้ `llm_calls.job_run_id` เป็น NULL ทุกแถว (`ON DELETE SET NULL`) จึงเขียน 0005 ใหม่ด้วยมือ:
   - เก็บ link ไว้ใน temp table ก่อน drop แล้วเขียนกลับหลัง rename
   - `events` ใช้ `ADD COLUMN` + inline CHECK เพื่อไม่ rebuild ซึ่งจะทำให้ FTS triggers หาย
5. 20:40 — seed: `demo-evt-04` = disputed, `demo-evt-05` = unverified; mapper `toEventSummary` (reason เป็น null เมื่อ none)
6. 20:41 — spawn subagent `frontend` พร้อม contract ของ types / ชื่อฟิลด์ฟอร์ม / data-testid / คำที่ห้ามใช้
7. 20:45 — (context ของ session ถูก compact ระหว่างรอ subagent ตรวจ `git status` / diff แล้วทำต่อ) เขียน `editorial/credibility.ts` และ refactor `event-gate.ts`:
   - `applyAutoRules`, `toDecision`
   - G6 ตาม policy
   - `evaluateStoredEventForAutoPublish` และ `storedEventGateReasons` (G1–G3 + reason)
8. 20:50 — relation gate (policy + `min_confidence`); summary@5 schema (lenient `.catch`) + prompt rules; mock / test fixtures; `EventContentWrite` / `AdminEventPatch` + content field keys; `byAdmin()` (`system` และ `system:*` นับเป็น pipeline)
9. 20:53 — digest-content บันทึก label; digest-links / digest deps รับ policy + threshold; config `RELATIONS_AUTO_PUBLISH_MIN_CONFIDENCE` (default ใน `types/editorial.ts` เพราะ config import `server/editorial` ไม่ได้ตาม §1); `.env.example`, compose, `types/config.ts`
10. 20:56 — brief ranking (`possible_misinformation` ไม่อยู่อันดับ 1–3); admin publish gate ใช้ `storedEventGateReasons`; ฟอร์ม save รับ level + reason (เขียนคู่กันเสมอ, none → reason null)
11. 20:58 — `ReevaluationRepository` + `jobs/reevaluate.ts` + registry (dry-run ไม่ claim slot) + CLI `--dry-run`
12. 21:00 — แก้ test helpers ตาม contract ใหม่ แล้วเขียน/แก้ tests:
    - G6 matrix และ stored gate
    - credibility
    - relation threshold
    - summary@5 leniency
    - digest credibility: floor, G3 reason, admin override คงอยู่หลัง re-summary
    - `reevaluate.test.ts`: dry-run, publish + audit, idempotent, multi_source, real failures, race skip, admin override, new evidence requeue → digest re-summary, relations publish/drop/rejected pair/possible-duplicate
    - brief rank
    - migration upgrade test
    - registry / CLI / config
    - admin save override
13. 21:04 — รับงาน subagent (badge, explainer, AI label, admin views, e2e) ตรวจ diff เพิ่ม e2e admin override round trip (`demo-evt-09`)
14. 21:05 — commit 4 commits ฝั่ง backend; `build`, `build:scripts`, `verify:prod-build`; smoke test `node build/scripts/job.js reevaluate_pending` (dry-run / run / skip / force / usage error) บนสำเนา DB ใน scratchpad
15. 21:07 — `E2E_PORT=4873 npx playwright test` (background); ระหว่างรอ อัปเดต ARCHITECTURE (§4–§6, §8–§12, §14, §16, §18) และ README checklist + ข้อ 6
16. 21:11 — commit UI + docs; secret scan ของ diff; รัน gate สุดท้าย; เขียน log นี้

## Files created / changed
- `migrations/0005_credibility_and_reevaluate.sql` (เขียนเอง), `migrations/meta/{0005_snapshot.json,_journal.json}` (drizzle-kit) และ `src/lib/server/db/migration-0005.test.ts` (ใหม่)
- `src/lib/types/{domain,views,jobs,llm,editorial,config,repositories}.ts` — levels/labels, DTO fields, job type + counters, summary@5 output, relation gate input, env name, `ReevaluationRepository`
- `src/lib/server/db/schema.ts`, `db/seed.ts`, `db/fixtures/demo.ts`
- `src/lib/server/db/repositories/{shared,digest,admin,index}.ts`, `reevaluation.ts` (ใหม่) — `byAdmin()`, `POLICY_ACTOR`, content fields, repo ใหม่
- `src/lib/server/editorial/{event-gate,relation-gate,index}.ts`, `credibility.ts` (ใหม่) + tests
- `src/lib/server/llm/tasks/summary.ts` + test, `llm/mock.ts`, `llm/test-fixtures.ts`
- `src/lib/server/jobs/{digest,digest-content,digest-links,brief-ranking,registry,cli-args,job-slots}.ts`, `reevaluate.ts` (ใหม่) + tests (`reevaluate.test.ts` ใหม่, `digest-security`, `digest`, `briefs`, `registry`, `cli-args`)
- `src/lib/server/config.ts` + test, `.env.example`, `docker-compose.yml`, `tests/pipeline/run-fixture-pipeline.ts`
- `src/routes/admin/admin-forms.server.ts`, `src/routes/admin/events/[id]/+page.server.ts`, `src/routes/admin/admin-actions.test.ts`
- โดย subagent frontend:
  - `src/lib/components/CredibilityLabel.svelte` (ใหม่)
  - `EventLabels`, `StoryCard`, `FeaturedStory`, `EventDetail`, `ConnectionList`
  - `admin/{EventReviewCard.svelte,admin-labels.ts}`, `format.ts`
  - `src/routes/admin/events/[id]/+page.svelte`
  - `tests/e2e/{ui,citations-relations,admin-flows,qa-helpers,security}.e2e.ts`
- `docs/ARCHITECTURE.md`, `README.md`

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 20:25 | `npm ci`; `npm run db:reset` | exit 0 / exit 0 |
| 20:25 | `npx vitest run` (baseline) | 64 files, 1042 passed |
| 20:36 | `npx drizzle-kit generate --name credibility_and_reevaluate` | 0005 generated; SQL rewritten by hand (see Errors) |
| 20:37 | `npm run db:reset` | exit 0 (fresh migrate incl. 0005) |
| 21:00 | `npx tsc --noEmit` | 0 errors outside the generated shadcn `ui/*/index.ts` noise |
| 21:01 | `npx vitest run` | 1025 passed, 17 failed (expected: old contract) → fixed |
| 21:03 | `npx vitest run src/lib/server/jobs/reevaluate.test.ts` | 12 passed (after 1 fix) |
| 21:04 | `npx vitest run src/lib/server/db/migration-0005.test.ts` | 1 passed |
| 21:04 | node check: drop parent table in a transaction with FK SET NULL | child link becomes NULL (confirms the 0005 hazard) |
| 21:05 | `npm run build`; `npm run build:scripts`; `npm run verify:prod-build` | exit 0 / exit 0 / exit 0 (284 files, no dev bypass) |
| 21:06 | `node build/scripts/job.js reevaluate_pending --dry-run` (copy of seeded DB, policy all) | exit 0, plan: 1 event published, 1 relation dropped, DB unchanged |
| 21:06 | same `--manual`, again, then `--force --manual`; `digest --dry-run` | succeeded → skipped `already_done` → succeeded with all counters 0 → exit 64 usage error |
| 21:07 | `E2E_PORT=4873 npx playwright test` | exit 0 — 342 passed (1.3 min) |
| 21:11 | `npm run check` | exit 0 — 0 errors, 0 warnings |
| 21:11 | `npm run lint` | exit 0 |
| 21:11 | `npx vitest run` | exit 0 — 67 files, 1098 passed |
| 21:12 | secret scan of `git diff 4df019a..HEAD` (URLs, e-mails, key patterns) + control/CRLF scan of changed files | only `*.invalid` / `example.org` / `editor@example.com` test values; no control chars, no CRLF |
| subagent | `ui`, `citations-relations`, `responsive`, `a11y`, `security`, `admin-*` specs | 334 passed (then 307 after its final style change) |

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 20:30 | `python3` heredoc | "Python was not found" | no Python on this machine (Store alias) | used Node scripts |
| 20:31 | `node -e` edit of `views.ts` / `schema.ts` | backticks inside the bash string were run as commands (`` `none` `` / `` `events` `` removed from comments) | bash command substitution in a double-quoted `node -e` | fixed both comments with the Edit tool, then wrote every later script to a scratchpad file with a quoted heredoc |
| 20:36 | drizzle-kit 0005 | generated SQL rebuilds `job_runs` with FKs effectively ON | the drizzle migrator wraps all migrations in `BEGIN…COMMIT`, where `PRAGMA foreign_keys=OFF` is a no-op; `DROP TABLE job_runs` would fire `llm_calls.job_run_id ON DELETE SET NULL` | hand-written 0005 saves and restores the links; `migration-0005.test.ts` checks it on a populated 0004 DB; ARCHITECTURE §18 #20. 0004 was safe (admin_actions has no FK) |
| 20:36 | design | a table-level CHECK on `events.credibility_level` would make drizzle-kit rebuild `events` and drop the FTS triggers | drizzle-kit rebuilds a table on any CHECK change | inline column CHECK in the SQL only; schema.ts comment explains it |
| 20:45 | session | context compacted while waiting for the subagent | long session | rebuilt state from `git status` / diff before going on |
| 20:46 | inline node script on `event-gate.ts` | `unexpected EOF while looking for matching '` | heredoc body with nested quotes / escaped backticks inside the Bash tool | rewrote the whole file with the Write tool |
| 20:47 | Edit / Write | "File has not been read yet" (several files) | the tool needs a Read first | Read, then Edit |
| 20:52 | `config.ts` | imported `./editorial/relation-gate` | breaks the §1 rule (config imports only zod/types) | moved `DEFAULT_RELATION_AUTO_PUBLISH_MIN_CONFIDENCE` to `types/editorial.ts` |
| 21:00 | `registry.ts` | `exitCodeFor(outcome)` type error in the dry-run path | `exitCodeFor` takes a `RunJobResult`, not a `JobOutcome` | inline status → exit code mapping |
| 21:01 | 17 unit tests | old expectations (every relation pending, G6 always, summary@4, admin form fields) | intended contract change | rewrote as policy matrices / new expectations |
| 21:03 | `reevaluate.test.ts` floor test | plain event got `unverified` instead of `none` | the multi_source digest already stores the floor label on pending events (correct); the test made the event non-sensitive afterwards | the test resets labels to `none` like pre-0005 rows |
| 21:06 | bundled job smoke test | `no such table: events` | `DATABASE_URL=file:/c/Users/...` is not a Windows path for node | `cygpath -m` path |
| 21:10 | `npm run lint` | unused `ne` (admin repo), unused destructured `_l` / `_r` (summary test) | leftovers of the refactor | removed |

## Deviations / decisions
- **Credibility in summary@5**, not extraction@1. extraction@1 and relations@1 are unchanged. Cached summary@4 outputs are not reused.
- **Relations use the same switch as events.** With `all`, a relation is published at confidence ≥ `RELATIONS_AUTO_PUBLISH_MIN_CONFIDENCE` and dropped below it. With `off` / `multi_source`, every relation stays pending as before, so dev and tests (default `off`) keep the review path.
  - Default **0.8**, not 0.75: it equals `CLUSTERING_MERGE_MIN_CONFIDENCE`, the other "confident model decision that changes public content".
  - The `possible_duplicate` relation from clustering stays pending; it does not go through this gate.
- **The backlog job does not regenerate anything (no LLM call).** The stored text already passed G4/G5 when it was saved, and G1–G3 run again on that stored text.
  - The label is the stored one plus the floor, so the 15 sensitive single-source events become `unverified`.
  - The model's own assessment arrives with the next re-summary. In `all`, new evidence makes the digest re-summarize a published event.
  - Events published by the job get no relations or Academy links until their next re-summary. Admin publish behaves the same way.
- **Extra step in `all` mode:** published events flagged `new_evidence_pending` (left over from `multi_source`) are requeued.
  - The flag is cleared and `summarized_at` is set back to the last content save, so the next digest re-summarizes them.
  - Otherwise they would wait for an admin forever, which goes against the owner decision.
- **A pending relation below the threshold is deleted.** Its full row is kept in the `system:policy` revision. Rejecting it was not an option: a rejection blocks the pair for every type.
- **The `system:policy` actor counts as the pipeline** (`byAdmin()` = not `system` and not `system:*`), so its revisions never lock the credibility fields against a re-summary. The ARCHITECTURE §3 contract is updated.
- **`possible_misinformation` in briefs:** it never takes ranks 1–3. When fewer than three other items exist it is left out of the brief rather than promoted.
- **The job also appears on `/admin/jobs`** (rerun → `rerun_reevaluate_pending` in `admin_actions`). It is not in the crontab.
- **`docs/AGENT_PLAN.md` was not changed.**

## Open issues / follow-ups for the orchestrator
- **Production order:**
  1. Deploy the image. On start the app runs migrate, which applies 0005.
  2. Run `docker compose exec scheduler node build/scripts/job.js reevaluate_pending --dry-run`.
  3. Read the `event re-evaluated` / `relation re-evaluated` lines and the `dry-run finished` counters.
  4. Run `docker compose exec scheduler node build/scripts/job.js reevaluate_pending --manual`.
  - Expect the 28 policy-held events to be published, unless their stored text now fails G1–G3.
  - The 2 pending relations are published when their confidence is ≥ 0.8. Otherwise they are deleted, with the row kept in `content_revisions`.
  - Take a `db:backup` first if you want an extra safety net.
- **No seeded `possible_misinformation` event:** the filled badge is covered by the admin round-trip e2e and the subagent's contrast check, not by the a11y spec.
- **Each commit was not built on its own;** all gates pass at HEAD.

## Review fixes (2026-11-13 21:26–21:45, Asia/Bangkok)

The orchestrator relayed an independent review ("merge after fixes"). All of it is done on the same branch.

### Steps
1. 21:26 — Read the review items. Planned one shared pure rule for the brief ranks, and a relation `origin` column so the possible-duplicate relation can be recognised reliably.
2. 21:27 — **MUST 3 / nit (top ranks).** Added `utils/brief-order.ts` with `TOP_RANKS` and `keepMisinformationOutOfTopRanks`.
   - `rankBriefCandidates` uses it, and `CORROBORATED_TOP_SLOTS` is now `TOP_RANKS`, so `TOP_SLOTS` is gone.
   - `readPublishedBrief` applies it again at read time and renumbers the ranks, so the home `featured` slot is covered too.
3. 21:28 — **SHOULD 4.** The floor in `digest-content.ts` now uses `(event.signals?.sensitive ?? false) || extraction.sensitive`.
4. 21:29 — **MUST 2.** Migration 0005 changes:
   - the temp table now has an `id` primary key and is filled with `INSERT … SELECT`;
   - the restore is `UPDATE … FROM`;
   - new index `llm_calls_job_run_id_idx`, created before the drop. It is also used by the per-run LLM cap and `usageForJobRun`. It was added to `schema.ts` and to the 0005 snapshot JSON, and `drizzle-kit generate` reports "No schema changes".
   - New test: 20k LLM calls across 200 runs migrate in about 0.5 s including seeding, with a guard at < 2.5 s.
5. 21:31 — **SHOULD 7.** `event_relations.origin` (`relations` | `possible_duplicate`): an added column with an inline CHECK.
   - Migration backfill: an existing pending `same_topic` relation whose event carries `possible_duplicate` is marked `possible_duplicate`.
   - `flagPossibleDuplicate` stores `origin = possible_duplicate`. A relations-task upsert never overwrites such an edge.
   - `listPendingRelations` lists only `origin = relations`; `publishPendingRelation` and `dropPendingRelation` refuse any other origin.
6. 21:33 — **MUST 1.** `applyEventDecision` now follows the same rule as `saveEventContent`: an unpublished event with an admin-edited content field becomes `pending_review [manual_flag]` and is not published.
   - It now resolves the status it wrote, or null when skipped.
   - A dry-run option makes the job's `--dry-run` report the same hold.
   - The job logs the final decision.
   - The test that expected the wrong behaviour was rewritten.
7. 21:35 — **SHOULD 6.** `publishPendingRelation` re-reads the row and re-checks `isRejectedPair` inside its immediate transaction. New counter: `relations_skipped`.
8. 21:36 — **SHOULD 5.** `reviewRelation(…, 'rejected')` also rejects the pair's unreviewed relations (published or pending, both directions), with one revision each. Admin-approved siblings are kept.
9. 21:37 — **SHOULD 8.** Added the "อัตโนมัติ (ให้ระบบประเมิน)" option.
   - The save action passes `releaseCredibility`. `updateEventIfCurrent` writes a revision with `after: { credibility_release: true }`, even when the patch is empty.
   - `adminEditedContentFields` reads revisions in `changed_at` order and drops the credibility keys at a release.
   - The label stays as stored until the next re-summary.
   - Editor select and hint updated; e2e option list updated.
10. 21:38 — **Nits.**
    - Explainer wording: "มีรายงานจากสำนักข่าวน้อยกว่า 2 สำนัก".
    - The event page's meta/OG description is prefixed with the label (e2e checks both the labelled and the unlabelled case).
    - `schema.ts` comments now say that the CHECKs on `events.credibility_level` and `event_relations.origin` live only in 0005.
11. 21:39 — New tests:
    - read-time demotion;
    - manual_flag hold, including the dry run;
    - possible-duplicate relation never published, even after the draft was published, and not taken over by upsert;
    - publish re-check after a rejection;
    - sibling rejection;
    - release, at repository, form and digest level;
    - stored-signal floor;
    - 20k migration.
12. 21:40 — Gates; ARCHITECTURE (§3, §5, §8, §11) and README updated; commits.

### Commands run & results
| Time | Command | Result |
|---|---|---|
| 21:30 | `npx drizzle-kit generate` (after index and origin in the snapshot) | "No schema changes, nothing to migrate" (no drift) |
| 21:30 | `npx vitest run src/lib/server/db/migration-0005.test.ts` | 2 passed (20k test 479 ms) |
| 21:39 | `npm run check` | exit 0, 0 errors, 0 warnings |
| 21:39 | `npm run lint` | exit 0 |
| 21:39 | `npx vitest run` | exit 0, 67 files, 1107 passed |
| 21:40 | `npm run build`; `npm run build:scripts`; `npm run verify:prod-build` | exit 0 / exit 0 / exit 0 |
| 21:40 | `E2E_PORT=4873 npx playwright test` | exit 0, 342 passed (1.3 min) |
| 21:42 | `npm run build:scripts`; `npm run verify:prod-build` (again, after the e2e rebuild) | exit 0 / exit 0 |
| 21:42 | bundled `job.js reevaluate_pending` on a fresh copy of the seeded DB (dry-run, run, `--force`) | dry-run plans 1 publish + 1 relation drop; the run does the same; the forced repeat has all counters 0 |
| 21:43 | control-character / CRLF scan of the changed files | clean |

### Errors & problems
| Time | Where | Error | Cause | Resolution |
|---|---|---|---|---|
| 21:40 | bundled job smoke test on the local `data/worldview.db` | `no such column: "origin"` | that DB had already applied the earlier 0005; drizzle's migrator skips a migration by its timestamp, not by hash | `npm run db:reset` and a fresh copy. **Any DB migrated with the first 0005 (the orchestrator's production copy) must be re-copied from production** before testing again. Production itself never ran 0005 |
| 21:41 | smoke test right after the e2e start | `Cannot find module build/scripts/job.js` | the e2e harness rebuilds `build/`, which empties `build/scripts` | ran `build:scripts` again after the e2e run |
| 21:35 | admin repo release test | revision `[0]` was the override, not the release | `revisionsFor` has no order | `.at(-1)` |
| 21:34 | Edit tool on `public-read.test.ts` | "File has not been read yet" | the tool needs a Read first | Read, then Edit |
