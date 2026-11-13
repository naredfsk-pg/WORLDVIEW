# Acceptance matrix — PRD §11 (MVP Definition of Done)

This file maps each PRD §11 item (1–12) to the tests that prove it, with the status as of Wave 3:
branch `test/acceptance-suite` from `main` @ `e074515`, 2026-11-13. Bugs are listed in
[`BUGS.md`](BUGS.md) and the measured numbers in [`BASELINE.md`](BASELINE.md).

> **Update, branch `fix/qa-wave3` (2026-11-13):** BUG-QA-001…010 are fixed. Every `test.fixme`
> and `it.todo` below now runs and passes; `KNOWN_A11Y_BUGS` is empty, so any serious or critical
> axe violation fails. Totals after the fixes: Vitest 711 passed (55 files), Playwright 318
> passed with 0 fixme. Future `/archive` months are out of range now, so the month-boundary tests
> use past months (Feb 2024/2025, 2025-12 → 2026-01). The rest of this file is the matrix as
> filed.

**Status key**:

- **Covered**: automated tests prove every part of the item.
- **Partial**: some of the item is proven, and the gap is named.
- **Gap**: no test covers the item.

| # | Item | Status |
|---|---|---|
| 1 | Mobile 375/1440, no horizontal overflow | **Covered**, extended to 6 widths × 2 themes × public and admin routes |
| 2 | 30 lessons by stable routes | **Covered** |
| 3 | 2–3 fixture sources grouped into one event | **Covered** |
| 4 | Ingestion idempotency | **Covered** |
| 5 | Timezones near midnight (UTC → Thai brief date) | **Covered** |
| 6 | Morning/evening briefs and `/brief/YYYY-MM-DD` | **Covered** (end to end with fixtures and the mock LLM) |
| 7 | Every public event cites ≥ 1 original source; no LLM-invented links | **Covered**; 1 defence-in-depth bug (BUG-QA-006) |
| 8 | Relations need a type, an explanation and evidence; no causal link without evidence | **Covered**; 1 defence-in-depth bug (BUG-QA-005) |
| 9 | LLM or provider down → archive and academy still work | **Covered** |
| 10 | No API keys in the client bundle; admin writes fail without auth | **Covered** |
| 11 | Job status, last-sync time, error log, backup/restore | **Partial**: backup/restore is a **gap** (a Wave 4 deliverable) |
| 12 | Performance baseline | **Covered** as a measured baseline (no targets yet), see `BASELINE.md` |

## How to run

Run every command from the repo root, with an uppercase `C:\` cwd on Windows.

```bash
npm ci && cp .env.example .env && npm run db:reset   # once
npm test                                             # Vitest: unit + integration (in-memory SQLite)
E2E_PORT=4373 npm run test:e2e                       # Playwright: builds, previews, then 3 projects
```

`npm run test:e2e` starts `tests/e2e/admin-e2e-server.ts`. That script resets `data/e2e.db`, runs a
production build and previews it on `E2E_PORT`. The JWKS for the test admin tokens listens on
`E2E_PORT + 1`. The Playwright projects run in order: `chromium` (public) → `admin` (it changes
event statuses) → `pipeline` (it writes new events and briefs).

| Run one item | Command |
|---|---|
| A single e2e file | `E2E_PORT=4373 npx playwright test tests/e2e/responsive.e2e.ts` |
| The pipeline only (runs its `chromium` and `admin` dependencies first) | `E2E_PORT=4373 npx playwright test --project=pipeline` |
| A single Vitest file | `npx vitest run src/lib/utils/date.acceptance.test.ts` |

The e2e preview always runs **with the LLM down**: `LLM_BASE_URL` points at `127.0.0.1:9`, a
closed port. It also runs with a **sentinel API key** in both the build and preview environments
(`tests/e2e/admin-auth.ts` › `llmSentinelEnv`). Every page test is therefore also an "LLM down"
test, and the bundle and response scans can look for a real planted value.

---

## 1. Mobile layout without horizontal overflow — Covered

The PRD asks for 375 px and 1440 px. The suite also covers the UI_DESIGN_SPEC §8 widths
360/390/430/768/1024/1440, in light and dark, on the public and admin routes. Each check asserts
`document.documentElement.scrollWidth <= innerWidth`, HTTP 200, a visible `<h1>`, and
`data-theme` equal to the emulated scheme.

| Test | What it proves |
|---|---|
| `tests/e2e/responsive.e2e.ts` › "public routes at {360,390,430,768,1024,1440}px ({light,dark}) › {route} has no horizontal overflow" | 108 tests: 9 routes (`/`, `/academy`, `/academy/week/1/day/1`, `/academy/week/4/day/30`, `/archive`, `/brief/2026-11-12`, `/connections`, `/events/demo-evt-01`, `/search?q=AI`) × 6 widths × 2 themes |
| `tests/e2e/admin-responsive.e2e.ts` › "admin pages at {width}px ({theme}) have no horizontal overflow" | 12 tests × 6 admin routes (`/admin`, `/admin/review`, `/admin/events/demo-evt-01`, `/admin/relations`, `/admin/briefs`, `/admin/jobs`) |
| `tests/e2e/ui.e2e.ts` › "layout at {375,1440}px ({theme}) › … loads without horizontal overflow" | The original PRD widths (pre-existing) |
| `tests/e2e/admin.e2e.ts` › "admin pages have no horizontal overflow at {375,1440}px" | Pre-existing |
| `tests/e2e/exploratory.e2e.ts` › "Thai text at 360 px › no heading or paragraph is clipped by its own box on the main routes" | Thai text wraps instead of being clipped by an `overflow` box at 360 px |

## 2. All 30 lessons by stable routes — Covered

| Test | What it proves |
|---|---|
| `tests/e2e/academy-lessons.e2e.ts` › "the content has 30 lessons, days 1–30, one stable route each" | The content files have 30 lessons, days 1–30, and 30 unique routes |
| `academy-lessons.e2e.ts` › "the Academy index links every lesson route across the four weeks" | The `lesson-card` links on `/academy?week=1..4` match the 30 routes exactly |
| `academy-lessons.e2e.ts` › "day {1..30} renders its title with previous/next links" | **All 30** routes render in a browser with the frontmatter title in `<h1>`, and the correct prev/next routes (none before day 1 or after day 30) |
| `tests/e2e/ui.e2e.ts` › "all 30 lesson routes load, and a day outside its week is 404"; "lesson URLs have one canonical form (no leading zeros)" | HTTP 200 for every route; 404 for a wrong week/day and for leading zeros (pre-existing) |
| `src/lib/content/academy.test.ts` | Frontmatter schema, 30 unique ids, the 7/7/7/9 split (pre-existing) |

## 3. Fixture feeds about one story → one event — Covered

| Test | What it proves |
|---|---|
| `src/lib/server/jobs/ingest.test.ts` › "acceptance #3: three sources on the same story become one event; unrelated stories stay separate" | Fixture feeds A (RSS), B (Atom) and C (RSS) → 1 event with 3 articles |
| `src/lib/server/news/grouping.test.ts` › "acceptance #3: …", "planGrouping regression cases (tests/fixtures/grouping/cases.json)", "does not merge into an existing event with a conflicting place", "keeps an unrelated Thai story apart from a Thai story pair", "is deterministic regardless of input order" | The grouping rules and the regression fixtures |
| `src/lib/server/jobs/digest.test.ts` › "ambiguous clustering › merges a draft into the other event on a confident same_event"; "keeps them separate when the LLM says related, or fails" | LLM-assisted clustering keeps wrong merges out |
| **New** `tests/e2e/pipeline.e2e.ts` › "#3: the three fixture reports of one story are one public event with three sources" | End to end: the published event page lists exactly the 3 stored fixture URLs |

## 4. Idempotency — Covered

| Test | What it proves |
|---|---|
| `src/lib/server/jobs/ingest.test.ts` › "acceptance #4: a second run of the same slot is skipped, and a forced rerun adds nothing"; "the next hourly slot re-runs without duplicates …" | Slot claim and dedupe |
| `src/lib/server/db/repositories/ingest.test.ts` › "inserts an article once; the same canonical URL is a duplicate …"; "dedups the same content hash within 7 days, but not after" | Repository constraints |
| `src/lib/server/db/repositories/job-runs.test.ts` › "JobRunRepository.claim" (5 tests) | `already_done` / `running` / stale reclaim |
| `src/lib/server/jobs/briefs.test.ts` › "builds both editions for a date, idempotently …"; "archive_snapshot › is idempotent …" | Briefs and snapshots |
| **New** `tests/e2e/pipeline.e2e.ts` › "#4: every step ran, and a forced second ingest + digest adds no rows" | On the real e2e database: `articles`, `events`, `event_articles` and `event_relations` row counts are equal before and after a forced rerun of ingest + digest |

## 5. Timezones — Covered

| Test | What it proves |
|---|---|
| `src/lib/utils/date.test.ts` › "toBriefDate (Asia/Bangkok, UTC+7)" (16:59:59.999Z vs 17:00Z, year, leap day) and others | Conversion core (pre-existing) |
| `src/lib/server/jobs/ingest.test.ts` › "acceptance #5: event_date follows Asia/Bangkok around midnight (16:59:59Z vs 17:00:00Z)" | Stored `event_date` |
| `src/lib/server/jobs/briefs.test.ts` › "acceptance #5: brief windows in Asia/Bangkok" (2 tests) | Brief window edges |
| `src/lib/utils/feed-timestamp.test.ts` | Zone-less input → null; leap day; future skew |
| **New** `src/lib/utils/date.acceptance.test.ts` › "feed timestamp → Bangkok brief date" (14 cases) | Chains `parseFeedTimestamp` → `toBriefDate` for every zone format a feed sends (`+0700`, `GMT`, `EST`, `Z`, `-05:00`, `+0700` without a colon) around Bangkok midnight, and at month, year and leap-day boundaries |
| **New** `date.acceptance.test.ts` › "… has no brief date (null, never a guess)" (5 cases) | Zone-less, date-only, 29 Feb 2027 and hour 24 give null |
| **New** `date.acceptance.test.ts` › "brief windows at month and year boundaries (ICT, [start, end))" (4 tests); "hourly job slots follow the Bangkok clock" | The 1 Jan morning window starts on 31 Dec; the leap-year evening window; no gap or overlap between 31 Dec and 1 Jan; an article at exactly 07:00 ICT belongs to the next window only |

## 6. Morning/evening briefs and `/brief/YYYY-MM-DD` — Covered

| Test | What it proves |
|---|---|
| `src/lib/server/jobs/briefs.test.ts` › "acceptance #6: morning and evening briefs" (6 tests) | Both editions; the draft/partial policy; no padding; demo events left out |
| `tests/e2e/ui.e2e.ts` › "briefs › /brief redirects to the latest brief"; "the best edition is chosen and other editions are linked"; "invalid dates and editions are 404" | Public routes on seed data (pre-existing) |
| **New** `tests/pipeline/run-fixture-pipeline.ts` | The real jobs through the real job runner against `DATABASE_URL`: ingest (fixture feeds, no network) → digest (`createMockLlmProvider(createDefaultMockHandlers())`, no network) → `brief_morning` + `brief_evening` 2026-11-13 → `archive_snapshot` 2026-11-13 → an empty-day brief → forced ingest + digest rerun |
| **New** `tests/e2e/pipeline.e2e.ts` › "#6: the morning and evening briefs and the archive show the new event" | `/brief/2026-11-13?edition=morning|evening|daily_snapshot` and `/archive?date=2026-11-13` link the event that the pipeline just published |
| **New** `tests/e2e/citations-relations.e2e.ts` › "every event linked from a published brief is public" | Every published brief (all dates and editions in the seed) renders, and every event it links is a 200 |

## 7. Citations — Covered (with BUG-QA-006)

| Test | What it proves |
|---|---|
| **New** `tests/e2e/citations-relations.e2e.ts` › "each public event shows >= 1 source, and every external link is a stored article URL" | Over **all** published events in `data/e2e.db`: ≥ 1 source link, `rel` contains `noopener`, and **every** `http(s)` link in `<main>` is a `canonical_url` from `articles`, so the LLM cannot invent a link |
| **New** `citations-relations.e2e.ts` › "every non-public event (draft, pending_review, hidden) is a 404" | All non-public rows |
| **New** `src/lib/server/db/repositories/public-read.acceptance.test.ts` › "acceptance #7: …" (4 tests) | At the read layer: every published event's sources equal its `event_articles` rows; a URL written into the LLM text is never turned into a link; draft, pending and hidden events are null |
| `src/lib/server/editorial/event-gate.test.ts` › "G1 …", "G3: rejects URLs anywhere in generated text …", "G5: rejects hallucinated refs …" | Write-side gates (pre-existing) |
| `src/lib/server/jobs/digest.test.ts` › "ingest → digest publishes every event with Thai text, stored sources and real evidence ids" | Pre-existing |
| `tests/e2e/ui.e2e.ts` › "event detail shows sections in order, sources, …" | Pre-existing |
| **Gap → BUG-QA-006** | The read layer still publishes an event that has lost all of its sources. It needs a row that bypassed the gates, so it is P3 |

## 8. Relations — Covered (with BUG-QA-005)

| Test | What it proves |
|---|---|
| **New** `citations-relations.e2e.ts` › "/connections: each relation shows all three, with stored evidence URLs"; "every related-event card on every public event page is well formed" | Every rendered relation has `data-relation-type`, a non-empty "ทำไมจึงเชื่อมโยง" explanation, and ≥ 1 evidence link that is a stored article URL |
| **New** `public-read.acceptance.test.ts` › "acceptance #8: …" (2 tests) | Every published relation has a valid type, an explanation and ≥ 1 resolvable evidence URL, causal ones included; pending relations are never public |
| `src/lib/server/editorial/relation-gate.test.ts` › "drops a relation without evidence, including causal ones"; "drops a relation whose evidence is not linked to either event"; "always sends causal types to human review …" | Write-side gate (pre-existing) |
| `src/lib/server/jobs/digest.test.ts` › "stores no relation without evidence, and always keeps potential_impact for review" | Pre-existing |
| `tests/e2e/ui.e2e.ts` › "potential_impact is labelled as possible, not confirmed"; "connections list relations with evidence links" | Pre-existing |
| **Gap → BUG-QA-005** | A published relation whose evidence does not resolve is still listed, with zero evidence links (P3, defence in depth) |

## 9. LLM or provider down — Covered

| Test | What it proves |
|---|---|
| **New** `tests/e2e/security-resilience.e2e.ts` › "acceptance #9: archive and academy keep working with the LLM down › {route} renders with its last-updated label" (7 routes) and "/health still answers 200 with a working database" | The production build, with the LLM pointed at a closed port, serves the archive (with and without a date), academy, a lesson, a brief, an event and search, each with the "อัปเดตล่าสุด" label |
| All e2e page tests | They run with the same LLM-down environment |
| `src/lib/server/editorial/llm-down.test.ts` › "LLM provider down (acceptance #9)" (3 tests) | A timeout on every model never throws; drafts go to `pending_review [llm_failed]`; published events are kept as they are; an unset endpoint behaves the same |
| `src/lib/server/jobs/digest.test.ts` › "acceptance #9: an LLM timeout leaves a new event pending_review [llm_failed] and a published event unchanged" | Pre-existing |
| `src/lib/server/jobs/ingest.test.ts` › "one failing source makes the run partial …"; "fails the run when every source fails …" | Provider down → the run is partial or failed, and pages keep the old data |
| `exploratory.e2e.ts` › "the shell says the data may be stale and that it contains demo data" | With no successful ingest, the stale label shows |

## 10. Security — Covered

| Test | What it proves |
|---|---|
| **New** `security-resilience.e2e.ts` › "the client bundle contains neither the planted LLM key nor LLM env names" | Scans every file in `build/client` for the sentinel key set at build time and for `LLM_API_KEY|OMNI_API_KEY|LLM_BASE_URL` |
| **New** `security-resilience.e2e.ts` › "no public page or data endpoint returns the planted key or the LLM URL" | Every main public route, and its `__data.json`, contains neither the sentinel nor the LLM URL at runtime |
| **New** `security-resilience.e2e.ts` › "every admin form action is 403 without a token, and nothing changes" | 9 actions: review publish/hide/flag, event save/hide, relation approve/reject, brief visibility, job rerun |
| **New** `security-resilience.e2e.ts` › "admin data endpoints are 403 without a token" | `__data.json` of `/admin`, `/admin/review`, `/admin/events/demo-evt-13`, `/admin/jobs` |
| **New** `security-resilience.e2e.ts` › "forged, expired, unsigned and malformed tokens are all 403" | Another key with the same `kid`, expired, another issuer, `alg: none`, garbage, empty; for GET and POST |
| `tests/e2e/admin.e2e.ts` › "access control" (5 tests) | No token, wrong audience or email, cross-origin POST (CSRF), no dev bypass in the build, no `CF_ACCESS_*` in the client (pre-existing) |
| `src/lib/server/auth/admin-guard.test.ts` | JWT verification, dev bypass guards, rate limit on admin POSTs (pre-existing) |

## 11. Operations — Partial

| Part | Status | Test |
|---|---|---|
| Job status | Covered | **New** `tests/e2e/pipeline.e2e.ts` › "#11: job status, last sync and the stored error are visible": `/admin/jobs` lists the ingest, brief and archive runs with their status; `admin.e2e.ts` › "jobs page offers every job …" |
| Last-sync timestamp | Covered | Same test: `/health` is `ok`, `stale: false`, and `last_ingest_succeeded_at` is within 10 minutes after the pipeline; `ui.e2e.ts` › "the last-update time is always shown in the shell"; `src/routes/health/health.test.ts` (4 tests); `src/lib/utils/freshness.test.ts` |
| Error logging | Covered | Same pipeline test: the empty-day brief run is `partial`, and `/admin/jobs` shows "ข้อผิดพลาด: 0 events, below DAILY_EVENT_TARGET_MIN 1"; `ingest.test.ts` › "records a crash inside the job body as a failed run with a sanitized error"; jobs log JSON lines with `duration_ms` and `rss_bytes` (`src/lib/server/jobs/runner.ts`) |
| Backup / restore | **Gap (Wave 4)** | No backup script, restore procedure or restore test exists yet. `README.md` does not mention one, and ARCHITECTURE §16 assigns it to Wave 4. Needed: an SQLite online backup (`.backup` or `VACUUM INTO`) on a schedule, a documented restore, and a test that restores into a fresh database and runs `npm run db:migrate` plus a `/health` check against it |

## 12. Performance — Covered (baseline only)

The PRD asks to measure, not to meet targets. [`BASELINE.md`](BASELINE.md) has the numbers:

- Lighthouse mobile on 4 routes: performance 88–96, LCP 2.3–2.4 s, TBT 0 ms
- Production build size: 132 KB gzip JS, 10 KB gzip CSS
- Fixture job runtime and peak RSS: digest with the mock LLM takes about 42 ms, with a peak RSS of
  about 232 MB
- Real-feed fetch duration: 92–289 ms per source

The fixture pipeline prints its own timings
(`npx tsx tests/pipeline/run-fixture-pipeline.ts` → `pipeline_summary`).

| Test | What it proves |
|---|---|
| **New** `tests/e2e/lighthouse-findings.e2e.ts` › "BUG-QA-009: at least 60 % of the text is 12 px or larger" (fixme) | Reproduces the Lighthouse `font-size` failure without Lighthouse |
| **New** `lighthouse-findings.e2e.ts` › "BUG-QA-010: /archive has CLS < 0.1 on a throttled mobile load" (fixme) | Reproduces the `/archive` layout shift with CDP slow-4G and 4× CPU |

---

## Accessibility (PRD §8.1) — axe-core

| Test | Scope |
|---|---|
| `tests/e2e/a11y.e2e.ts` › "axe ({light,dark}) › {route} has no new serious or critical violations" | 22 tests: 11 public routes (the 9 above, `/search` and a 404 page) × 2 themes |
| `tests/e2e/admin-a11y.e2e.ts` › "admin pages ({light,dark}) have no new serious or critical violations" | 6 admin routes × 2 themes |
| `a11y.e2e.ts` › "known accessibility bugs › BUG-QA-001 … BUG-QA-004" | `test.fixme`, one per known serious violation |

The results on the production build, 16 routes × 2 themes:

| Impact | Rule | Where | Nodes | Bug |
|---|---|---|---|---|
| critical | — | — | 0 | — |
| serious | `label-content-name-mismatch` | Every page (sidebar logo link), both themes | 16 per theme | BUG-QA-001 |
| serious | `color-contrast` | `/archive` calendar, both themes | 17 | BUG-QA-002 |
| serious | `color-contrast` | `.text-faint` on `/academy/week/1/day/1` (2 nodes) and `/connections` (1), light theme only | 3 | BUG-QA-003 |
| serious | `definition-list` | `/events/demo-evt-01`, both themes | 1 | BUG-QA-004 |
| moderate | `heading-order` | `/brief/2026-11-12`, both themes | 1 | BUG-QA-008 (no fixme, by policy) |
| minor | — | — | 0 | — |

The admin pages have no violations other than the shell's logo link (BUG-QA-001).

## Exploratory checks

These guards came out of the exploratory session. The findings are in `BUGS.md` › "Not bugs".

| Area | Test (`tests/e2e/exploratory.e2e.ts` unless stated) |
|---|---|
| Keyboard-only navigation | "keyboard › the first Tab reaches the skip link, which moves to the main content"; `admin-flows.e2e.ts` › "the review queue and the edit form are usable with the keyboard only" |
| The `/` search shortcut | "keyboard › `/` typed inside the search field is text, and Ctrl+/ does not open search"; `ui.e2e.ts` › "the / key opens the search dialog, which navigates to /search" |
| Theme persistence | "theme › an invalid stored theme falls back to the OS preference"; "a saved theme wins over the OS preference on every page"; `ui.e2e.ts` › "theme choice persists across a reload" |
| Archive month boundaries | "previous/next cross the year boundary in both directions"; "month lengths: Feb 2028 has 29 days, Feb 2027 has 28"; "a month without briefs shows the empty state; invalid input never 500s"; "BUG-QA-007 …" (fixme) |
| Empty, stale and demo states | "the shell says the data may be stale and that it contains demo data"; "a search with no results shows the empty state"; `ui.e2e.ts` › "a date without a brief shows the empty state" |
| Admin review → publish → public, and the 409 conflict | `admin.e2e.ts` › "publishing from the review queue makes the event public", "a hidden event 404s publicly"; `admin-flows.e2e.ts` › "a second editor saving a stale form gets the 409 conflict and keeps their input" |
| Thai rendering at 360 px | "Thai text at 360 px › …"; `responsive.e2e.ts` at 360 px; manual screenshots reviewed |

## Test counts

| Suite | Before (main @ e074515) | After | New |
|---|---|---|---|
| Vitest | 667 passed (52 files) | 699 passed + 2 todo (54 files) | 32 passed + 2 todo |
| Playwright | 70 passed (3 files) | 280 passed + 7 fixme (287 listed, 14 files) | 210 passed + 7 fixme (217) |
